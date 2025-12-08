# services/architect.py
from __future__ import annotations
import re
from typing import Dict, Any, Tuple, List

# NĂˇzvy, ktorĂ© sĂş len zĂˇstupnĂ© a chceme ich premenovaĹĄ na skutoÄŤnĂ© akcie
GENERIC_TASK_NAMES = {"condition", "otherwise", "true", "false", "if", "else"}

TASK_TYPE_ALIASES = {
    "task",
    "user_task",
    "usertask",
    "service_task",
    "servicetask",
}


def _is_generic_task_name(nd: Dict[str, Any]) -> bool:
    s = (nd.get("name") or nd.get("label") or "").strip().lower()
    return s in GENERIC_TASK_NAMES


# -----------------------------
# Parsovanie textu gateway
# -----------------------------
def _extract_cond_then_else(text: str) -> Tuple[str, str, str] | None:
    """
    Vytiahne (podmienka, then_akcia, else_akcia) z frĂˇz typu:
    SK: "Ak je platba ĂşspeĹˇnĂˇ, odoĹˇli tovar; inak upozorni zĂˇkaznĂ­ka"
    EN: "If payment is successful, ship goods; else notify customer"
    """
    if not text:
        return None
    s = " ".join(text.split())

    sk_patterns = [
        r"^Ak\s+je\s+(.*?),\s*(.*?)(?:;|,)\s*(inak|otherwise)\s+(.*)$",
        r"^Ak\s+(.*?),\s*(.*?)(?:;|,)\s*(inak|otherwise)\s+(.*)$",
    ]
    en_patterns = [
        r"^If\s+(.*?),\s*(.*?)(?:;|,)\s*(else|otherwise)\s+(.*)$",
    ]
    for pat in sk_patterns + en_patterns:
        m = re.match(pat, s, flags=re.IGNORECASE)
        if m:
            cond, then_act, _else_kw, else_act = m.groups()
            return cond.strip(), then_act.strip(), else_act.strip()
    return None


def _extract_cond_then(text: str) -> Tuple[str, str] | None:
    """
    Vytiahne (podmienka, then_akcia) z frĂˇz typu:
    SK: "Ak je platba ĂşspeĹˇnĂˇ, odoĹˇli tovar"
    EN: "If payment is successful, ship goods"
    """
    if not text:
        return None
    s = " ".join(text.split())

    for pat in [r"^Ak\s+je\s+(.*?),\s*(.*)$", r"^Ak\s+(.*?),\s*(.*)$"]:
        m = re.match(pat, s, flags=re.IGNORECASE)
        if m:
            cond, then_act = m.groups()
            return cond.strip(), then_act.strip()

    m = re.match(r"^If\s+(.*?),\s*(.*)$", s, flags=re.IGNORECASE)
    if m:
        cond, then_act = m.groups()
        return cond.strip(), then_act.strip()
    return None


def _mk_question(cond: str) -> str:
    q = cond.strip().rstrip("?.;:, ")
    if not q.endswith("?"):
        q = q[:1].upper() + q[1:] + "?"
    return q


# -----------------------------
# Graph helpers
# -----------------------------
def _build_graph(engine_json: Dict[str, Any]):
    nodes = {n["id"]: n for n in engine_json.get("nodes", [])}
    outgoing: Dict[str, List[Dict[str, Any]]] = {n_id: [] for n_id in nodes}
    incoming: Dict[str, List[Dict[str, Any]]] = {n_id: [] for n_id in nodes}
    for f in engine_json.get("flows", []):
        s = f.get("source") or f.get("sourceId")
        t = f.get("target") or f.get("targetId")
        if not s or not t:
            # flow je nevalidnĂ˝ â€“ preskoÄŤ, ale nepadni
            continue
        f["source"], f["target"] = (
            s,
            t,
        )  # normalizuj, nech sa ÄŹalej uĹľ pouĹľĂ­va jednotne
        outgoing.setdefault(s, []).append(f)
        incoming.setdefault(t, []).append(f)
    return nodes, outgoing, incoming


def _is_task_type(t: str) -> bool:
    tt = (t or "").replace("-", "_").lower()
    return tt in TASK_TYPE_ALIASES or tt in {"task", "usertask", "servicetask"}


def _walk_to_first_task(start_id: str, nodes, outgoing):
    """
    Prejde z targetu flow ÄŹalej, kĂ˝m nenĂˇjde prvĂ˝ task (preskoÄŤĂ­ event/gateway).
    """
    seen = set()
    cur = start_id
    while cur and cur not in seen:
        seen.add(cur)
        nd = nodes.get(cur)
        if not nd:
            return None
        if _is_task_type(nd.get("type")):
            return nd
        outs = outgoing.get(cur, [])
        if not outs:
            return None
        cur = outs[0]["target"]
    return None


# -----------------------------
def align_gateway_lanes(engine_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Úprava lane pre gateway tak, aby split ostal v lane prichádzajúcej aktivity
    a join prebral lane nasledujúceho kroku.
    """
    nodes = engine_json.get("nodes", [])
    flows = engine_json.get("flows", [])
    if not nodes or not flows:
        return engine_json

    gateway_ids = [
        n["id"]
        for n in nodes
        if (n.get("type") or "").lower()
        in {"exclusive_gateway", "parallel_gateway", "inclusive_gateway"}
    ]
    if not gateway_ids:
        return engine_json

    node_by_id = {n["id"]: n for n in nodes}
    incoming: Dict[str, List[Dict[str, Any]]] = {gid: [] for gid in gateway_ids}
    outgoing: Dict[str, List[Dict[str, Any]]] = {gid: [] for gid in gateway_ids}

    for flow in flows:
        src = flow.get("source") or flow.get("sourceRef") or flow.get("sourceId")
        tgt = flow.get("target") or flow.get("targetRef") or flow.get("targetId")
        if tgt in incoming:
            incoming[tgt].append(flow)
        if src in outgoing:
            outgoing[src].append(flow)

    for gid in gateway_ids:
        gateway = node_by_id.get(gid)
        if not gateway:
            continue
        in_flows = incoming.get(gid, [])
        out_flows = outgoing.get(gid, [])

        if len(in_flows) == 1 and len(out_flows) >= 2:
            src_id = (
                in_flows[0].get("source")
                or in_flows[0].get("sourceRef")
                or in_flows[0].get("sourceId")
            )
            lane = node_by_id.get(src_id, {}).get("laneId")
            if lane:
                gateway["laneId"] = lane
            continue

        if len(in_flows) >= 2 and len(out_flows) == 1:
            tgt_id = (
                out_flows[0].get("target")
                or out_flows[0].get("targetRef")
                or out_flows[0].get("targetId")
            )
            lane = node_by_id.get(tgt_id, {}).get("laneId")
            if lane:
                gateway["laneId"] = lane

    return engine_json


# -----------------------------
# Tidy: Yes/No gateway
# -----------------------------
def tidy_yes_no_gateway(
    engine_json: Dict[str, Any], locale: str = "sk"
) -> Dict[str, Any]:
    nodes, outgoing, incoming = _build_graph(engine_json)
    locale_lower = (locale or "").lower()

    for n in list(nodes.values()):
        ntype = (n.get("type") or "").lower()
        if ntype != "exclusive_gateway":
            continue

        gw_text = (n.get("name") or n.get("label") or "").strip()

        cond = then_act = else_act = None

        # 1) Skus "Ak..., A; inak B"
        parsed = _extract_cond_then_else(gw_text)
        if parsed:
            cond, then_act, else_act = parsed
            n["name"] = _mk_question(cond)
        else:
            # 2) Skus "Ak..., A" (bez else)
            parsed2 = _extract_cond_then(gw_text)
            if parsed2:
                cond, then_act = parsed2
                n["name"] = _mk_question(cond)

        outs = outgoing.get(n["id"], [])

        def _ensure_flow_label(flow, text):
            if not flow or not text:
                return
            if flow.get("name") or flow.get("label"):
                return
            flow["name"] = text
            flow["label"] = text

        # Premenuj prvy task na YES vetve (ak je genericky)
        if then_act and len(outs) >= 1:
            first_task_yes = _walk_to_first_task(outs[0]["target"], nodes, outgoing)
            if first_task_yes and _is_generic_task_name(first_task_yes):
                first_task_yes["name"] = then_act

        # Ak mame aj else_act (plny format), premenuj aj prvy task na NO vetve
        if else_act and len(outs) >= 2:
            first_task_no = _walk_to_first_task(outs[1]["target"], nodes, outgoing)
            if first_task_no and _is_generic_task_name(first_task_no):
                first_task_no["name"] = else_act

        # Menovky na sipkach, ak chybaju
        if len(outs) == 2:
            yes_label = "Áno" if locale_lower.startswith("sk") else "yes"
            no_label = "Nie" if locale_lower.startswith("sk") else "no"
            _ensure_flow_label(outs[0], yes_label)
            _ensure_flow_label(outs[1], no_label)

    return engine_json


# --- helpers pre stupne uzlov (in/out) ---
def _build_degrees(engine_json: Dict[str, Any]):
    indeg = {}
    outdeg = {}
    for n in engine_json.get("nodes", []):
        indeg[n["id"]] = 0
        outdeg[n["id"]] = 0
    for f in engine_json.get("flows", []):
        s = f.get("source") or f.get("sourceId")
        t = f.get("target") or f.get("targetId")
        if s in outdeg:
            outdeg[s] += 1
        if t in indeg:
            indeg[t] += 1
    return indeg, outdeg


def _locale_join_label(locale: str) -> str:
    return "Zlúč rozhodnutia" if locale.lower().startswith("sk") else "Merge"


def tidy_join_gateway_names(
    engine_json: Dict[str, Any], locale: str = "sk"
) -> Dict[str, Any]:
    """
    Ak je gateway typu exclusive a sprĂˇva sa ako JOIN (in_degree >= 2 a out_degree == 1),
    zruĹˇ mu 'otĂˇzku' a nastav neutrĂˇlne meno (alebo nechaj prĂˇzdne).
    """
    indeg, outdeg = _build_degrees(engine_json)
    for n in engine_json.get("nodes", []):
        t = (n.get("type") or "").lower()
        if t not in {"exclusive_gateway", "gateway"}:
            continue
        is_join = indeg.get(n["id"], 0) >= 2 and outdeg.get(n["id"], 0) == 1
        if is_join:
            # buÄŹ prĂˇzdne meno, alebo mierne popisnĂ©
            n["name"] = _locale_join_label(locale)
    return engine_json


def tidy_then_task_prefix(engine_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    OdstrĂˇni z task nĂˇzvu Ăşvod 'je <podmienka>, ' alebo 'If <cond>, ' ak sa tam omylom dostal.
    """
    pat_list = [
        r"^\s*je\s+[^,]+,\s*",  # SK: "je suma > 1000, schvĂˇÄľ..."
        r"^\s*ak\s+[^,]+,\s*",  # SK: "ak suma > 1000, schvĂˇÄľ..." (pre istotu)
        r"^\s*if\s+[^,]+,\s*",  # EN: "if amount > 1000, approve..."
        r"^\s*inak\s+",  # SK: odstrĂˇĹ ĂşvodnĂ© "Inak"
        r"^\s*potom\s+",  # SK: odstrĂˇĹ ĂşvodnĂ© "Potom"
        r"^\s*else\s+",  # EN: odstrĂˇĹ ĂşvodnĂ© "Else"
        r"^\s*otherwise\s+",  # EN: odstrĂˇĹ ĂşvodnĂ© "Otherwise"
    ]
    compiled = [re.compile(pat, flags=re.IGNORECASE) for pat in pat_list]

    for n in engine_json.get("nodes", []):
        if (n.get("type") or "").lower() not in {"task", "usertask", "servicetask"}:
            continue
        name = (n.get("name") or "").strip()
        if not name:
            continue
        new = name
        for pat in compiled:
            new = pat.sub("", new)
        if new != name:
            n["name"] = new.strip()
    return engine_json
