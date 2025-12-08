# Changelog

## 2025-12-08
- Inicializacia changelogu (pridany korenovy CHANGELOG.md).
- Wizard modely: pridaný PATCH /wizard/models/{id} na premenovanie, test scenár pre rename, UI modal doplnený o Otvoriť/Premenovať/Zmazať a API helpery pre delete/rename.
- Úložisko modelov: ignorovanie `backend/data/models/` v Gite, `model_storage` vytvorí priečinok cez os.makedirs.
- Map editor: zvýraznené inline editovanie textu (červená, vyšší kontrast).
- Modal Uložené modely: vylepšený UI (nadpisy stĺpcov, európsky formát dátumov, vyhľadávanie, triedenie podľa updated_at, hierarchia tlačidiel, hover/tabuľka styling, confirm pri mazaní).
- Model storage: možné nasmerovať na persistent disk cez env BPMN_MODELS_DIR (default data/models), testy používajú dočasné diry.
