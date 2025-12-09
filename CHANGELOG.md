# Changelog

## 2025-12-09
- Process Card: nahradenie pôvodného wizardu novým drawerom s jednotným ProcessCardState (generator input + meta), toggle rail, default otvorenie, mapovanie na generate/save/load a auto-prefill pri načítaní modelu.
- Backend wizard models: model_storage a schémy rozšírené o voliteľné `generator_input` a `process_meta`, list endpoint vracia meta (napr. version); GET/rename zachovávajú meta; testy upravené.
- UI Uložené modely: tabuľka doplnená o stĺpec „Verzia“ (process_meta.version) a hint pri poli Verzia v karte procesu.
- Štýly: drawer Process Card rozšírený (~640–720px), ľavý rail zväčšený (144px) a horizontálne tlačidlo s väčším paddingom.

## 2025-12-08
- Inicializacia changelogu (pridany korenovy CHANGELOG.md).
- Wizard modely: pridanÆñ PATCH /wizard/models/{id} na premenovanie, test scenÆór pre rename, UI modal doplnenÆñ o Otvori‘¤/Premenova‘¤/Zmaza‘¤ a API helpery pre delete/rename.
- Æçlo‘–isko modelov: ignorovanie `backend/data/models/` v Gite, `model_storage` vytvorÆð prieŽ›inok cez os.makedirs.
- Map editor: zvÆñraznenÆc inline editovanie textu (Ž›ervenÆó, vy‘ó‘óÆð kontrast).
- Modal Ulo‘–enÆc modely: vylep‘óenÆñ UI (nadpisy stŽ­pcov, eurÆˆpsky formÆót dÆótumov, vyhŽ–adÆóvanie, triedenie podŽ–a updated_at, hierarchia tlaŽ›idiel, hover/tabuŽ–ka styling, confirm pri mazanÆð).
- Model storage: mo‘–nÆc nasmerova‘¤ na persistent disk cez env BPMN_MODELS_DIR (default data/models), testy pou‘–ÆðvajÆ­ doŽ›asnÆc diry.
