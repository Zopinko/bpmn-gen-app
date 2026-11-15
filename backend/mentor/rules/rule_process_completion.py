from collections import defaultdict

from .common import make_finding, target_type_for_node

FLOW_NODES = {"start", "end", "activity", "callactivity", "subprocess", "transaction"}


def _walk(starts, edges, blocked=None):
    seen = set()
    pending = list(starts)
    while pending:
        node = pending.pop()
        if node in seen or node == blocked:
            continue
        seen.add(node)
        pending.extend(edges[node])
    return seen


def _has_parallel_join(branches, joins, outgoing):
    reachable = [_walk([branch], outgoing) for branch in branches]
    for join in joins.intersection(*reachable):
        # Every branch must feed its own incoming path into the join. A merge
        # before the join, or a path that ends without it, defeats synchronization.
        paths = [_walk([branch], outgoing, blocked=join) for branch in branches]
        used = set()
        for branch, path in zip(branches, paths):
            if (path & used or (branch != join and not any(join in outgoing[node] for node in path))
                    or any(not outgoing[node] for node in path)):
                break
            used.update(path)
        else:
            return True
    return False


def check(engine, index):
    findings = []
    scopes = defaultdict(set)
    scope_of = {}
    for pool in index.lane_pool_id.values():
        scopes.setdefault((pool, None), set())
    for node, token in index.node_type_token.items():
        if token in FLOW_NODES or token.endswith(("task", "gateway", "event")):
            scope = (index.node_pool_id[node], index.node_subprocess_id[node])
            scopes[scope].add(node)
            scope_of[node] = scope
    if index.nodes and not scopes:
        scopes[(str(engine.get("processId") or "pool_default"), None)] = set()
    outgoing, incoming = defaultdict(set), defaultdict(set)
    for flow_id, flow in index.flows_by_id.items():
        if index.flow_type_token[flow_id] != "sequenceflow":
            continue
        source = str(flow.get("source") or flow.get("sourceRef") or flow.get("sourceId") or "")
        target = str(flow.get("target") or flow.get("targetRef") or flow.get("targetId") or "")
        if source in scope_of and scope_of[source] == scope_of.get(target):
            outgoing[source].add(target)
            incoming[target].add(source)

    def add(rule, target, kind, message, *, hard=True):
        findings.append(make_finding(rule, "HARD" if hard else "SOFT", target, kind,
                                     message, "", 1, "model_invalid"))

    for (pool, subprocess), members in scopes.items():
        ordered = [node for node in index.nodes_by_id if node in members]
        starts = [node for node in ordered if index.node_type_token[node] in {"start", "startevent"}]
        ends = [node for node in ordered if index.node_type_token[node] in {"end", "endevent"}]
        scope_id = subprocess or pool
        scope_type = "subprocess" if subprocess else "unknown"
        if not starts and not subprocess:
            add("process_missing_start", scope_id, scope_type, "Add a start event.")
        if not ends and not subprocess and members.difference(starts):
            # Keep the guide's existing end and connection actions available.
            add("process_missing_end", scope_id, scope_type, "Add an ending.", hard=False)

        # A boundary event is enabled by its attached activity, not a sequence flow.
        entry_edges = defaultdict(set, {node: outgoing[node].copy() for node in members})
        for node_id in members:
            node = index.nodes_by_id[node_id]
            attached = str(node.get("attachedToRef") or node.get("attachedTo") or node.get("attached_to") or "")
            if index.node_type_token[node_id] == "boundaryevent" and attached in members:
                entry_edges[attached].add(node_id)

        # A subprocess can begin implicitly at its entry nodes.
        entries = starts or ([node for node in ordered if not incoming[node]
                             and index.node_type_token[node] != "boundaryevent"] if subprocess else [])
        exits = ends or ([node for node in ordered if not outgoing[node]] if subprocess else [])
        reached = _walk(entries, entry_edges)
        reaches_end = _walk(exits, incoming)
        parallels = {node for node in members if index.node_type_token[node] == "parallelgateway"}
        joins = {node for node in parallels if len(incoming[node]) > 1}
        for node in ordered:
            kind = target_type_for_node(index.node_type_token[node])
            if entries and node not in reached:
                add("node_unreachable_from_start", node, kind, "Connect this element to the start.")
            elif exits and node not in reaches_end and node not in ends:
                add("node_no_path_to_end", node, kind, "Connect this element to an ending.",
                    hard=bool(outgoing[node]))
            if node in parallels and len(outgoing[node]) > 1:
                if not _has_parallel_join(outgoing[node], joins - {node}, outgoing):
                    add("parallel_branches_not_joined", node, kind, "Join the parallel paths.")
    return findings
