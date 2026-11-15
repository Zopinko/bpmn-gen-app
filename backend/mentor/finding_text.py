from .rule_engine import build_index


# Keep finding IDs stable for saved reviews and existing fix actions.
TEXT = {
    "process_missing_start": ("Procesu chýba začiatok. Pridaj udalosť, ktorá ho spustí.", "The process has no start. Add the event that triggers it."),
    "process_missing_end": ("Procesu chýba ukončenie. Označ, kde sa končí.", "The process has no ending. Mark where it ends."),
    "node_unreachable_from_start": ("K prvku {target} sa zo začiatku nedá dostať. Pripoj ho k toku zo začiatku.", "“{target}” cannot be reached from the start. Connect it to a path from the start."),
    "node_no_path_to_end": ("Z prvku {target} nevedie cesta ku koncu. Pridaj pokračovanie, ktoré môže skončiť.", "“{target}” has no path to an ending. Connect it to a path that can finish."),
    "parallel_branches_not_joined": ("Paralelné vetvy za prvkom {target} sa nespoja. Priveď každú do spoločnej paralelnej brány.", "The parallel paths from “{target}” do not rejoin. Bring each one into the same parallel gateway."),
    "lane_is_empty": ("Rola „{target}“ zatiaľ nemá žiadny krok. Pridaj krok alebo rolu odstráň.", "“{target}” has no steps yet. Add a step or remove the role."),
    "lane_is_disconnected": ("Kroky roly „{target}“ sú odpojené od procesu. Prepoj ich so zvyškom toku.", "The steps for “{target}” are disconnected. Link them to the rest of the process."),
    "lane_missing_name": ("Táto rola nemá názov. Pomenuj ju podľa toho, kto kroky vykonáva.", "This role has no name. Name it after whoever performs its steps."),
    "activity_is_isolated": ("Krok „{target}“ nie je spojený s procesom. Prepoj ho šípkou alebo ho odstráň.", "The step “{target}” is disconnected. Link it with an arrow or remove it."),
    "activity_requires_name": ("Tento krok nemá názov. Napíš, čo sa v ňom vykoná.", "This step has no name. Describe what happens in it."),
    "event_requires_name": ("Táto udalosť nemá názov. Napíš, čo pri nej nastane.", "This event has no name. Describe what happens when it occurs."),
    "gateway_diverging_min_two_outgoing": ("Z brány „{target}“ vedie menej ako dvojica vetiev. Doplň chýbajúce pokračovanie.", "The gateway “{target}” has fewer than two paths. Add the missing path."),
    "gateway_requires_incoming": ("Do brány „{target}“ nevedie žiadna šípka. Pripoj ju k predchádzajúcemu kroku.", "There is no arrow into “{target}”. Connect the gateway to the previous step."),
    "gateway_is_redundant": ("Brána „{target}“ tok nerozdeľuje ani nespája. Zváž priame prepojenie krokov.", "The gateway “{target}” neither splits nor joins paths. Consider connecting the steps directly."),
    "gateway_no_mixed_mode": ("Brána „{target}“ naraz spája aj rozdeľuje tok. Použi na to dve samostatné brány.", "The gateway “{target}” joins and splits paths at once. Use a separate gateway for each."),
    "xor_outgoing_flows_require_names": ("Vetva „{target}“ nemá podmienku. Pomenuj výsledok, pri ktorom sa použije.", "The path “{target}” has no condition. Name the outcome that makes this path apply."),
    "boundary_event_no_incoming": ("Do udalosti „{target}“ vedie šípka. Udalosť už spúšťa krok, ku ktorému je pripojená, preto šípku odstráň.", "An arrow leads into “{target}”. Remove it because the attached step already triggers this event."),
    "boundary_event_max_one_outgoing": ("Z udalosti „{target}“ vedie viac ako jedna šípka. Ponechaj jedno priame pokračovanie.", "More than one arrow leaves “{target}”. Keep one direct continuation."),
    "subprocess_start_event_none": ("Začiatok „{target}“ je v podprocese. Odstráň z neho špeciálny spúšťač.", "The start event “{target}” is inside a subprocess. Remove its special trigger."),
    "seqflow_no_cross_pool": ("Šípka „{target}“ spája dva samostatné procesy. Použi tok správ medzi účastníkmi.", "The arrow “{target}” crosses between separate processes. Use a message flow between participants."),
    "seqflow_no_cross_subprocess": ("Šípka „{target}“ prechádza hranicou podprocesu. Pripoj ju k podprocesu ako celku alebo spoj dva kroky vnútri.", "The arrow “{target}” crosses a subprocess boundary. Connect to the subprocess itself or link two steps inside it."),
    "message_flow_between_pools": ("Tok správ „{target}“ je v jednom procese. Medzi jeho krokmi použi obyčajnú šípku.", "The message flow “{target}” stays inside one process. Use a sequence arrow between its steps."),
    "text_annotation_empty": ("Táto poznámka je prázdna. Doplň text alebo ju odstráň.", "This note is empty. Add text or remove it."),
}


def _unnamed_label(item, english):
    """What to call an element that has no name (never its internal id)."""
    kind = str(item.get("type") or "").lower()
    if "parallel" in kind:
        return "parallel split" if english else "súbežné vetvenie"
    if "gateway" in kind:
        return "decision" if english else "rozhodnutie"
    if "start" in kind:
        return "start" if english else "začiatok"
    if "end" in kind:
        return "end" if english else "koniec"
    return None


def localize_findings(findings, engine, locale):
    index = build_index(engine)
    english = str(locale or "").lower().startswith("en")
    lanes = {str(lane.get("id")): lane.get("name") for lane in index.lanes}
    for finding in findings:
        rule = finding.id.partition(":")[0]
        if rule not in TEXT:
            continue
        target_id = finding.target.id
        item = index.nodes_by_id.get(target_id) or index.flows_by_id.get(target_id) or {}
        label = item.get("name") or item.get("label") or lanes.get(target_id) or _unnamed_label(item, english)
        if not label and item.get("source"):
            source_id = str(item["source"])
            source = index.nodes_by_id.get(source_id, {})
            label = source.get("name") or source.get("label") or _unnamed_label(source, english) or source_id
        message = TEXT[rule][english].format(target=label or target_id)
        if lane := lanes.get(index.node_lane_id.get(target_id)):
            message += f' Role: “{lane}”.' if english else f' Rola „{lane}“.'
        finding.message = message
        finding.proposal = ""
