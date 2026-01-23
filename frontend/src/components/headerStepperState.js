const STEPS = [
  {
    id: "basic",
    label: "Zaklad",
    tooltip: "Nazov procesu, lanes a spustac.",
  },
  {
    id: "flow",
    label: "Tok procesu",
    tooltip: "Vytvor zakladny tok, aby mapa mala kostru.",
  },
  {
    id: "activities",
    label: "Aktivity",
    tooltip: "Dopln ulohy a rozhodnutia do lanes.",
  },
  {
    id: "review",
    label: "Kontrola",
    tooltip: "Spusti mentora a oprav zistene problemy.",
  },
  {
    id: "story",
    label: "Kontrola pribehu",
    tooltip: "Skontroluj pribeh procesu v ludskej reci.",
  },
  {
    id: "done",
    label: "Hotovo",
    tooltip: "Uloz alebo exportuj hotovy model.",
  },
];

const normalizeText = (value) => String(value || "").trim();
const toArray = (value) => (Array.isArray(value) ? value : []);

const hasStartNode = (nodes) =>
  nodes.some((node) => normalizeText(node?.type).toLowerCase().includes("start"));

const countTasks = (nodes) =>
  nodes.filter((node) => normalizeText(node?.type).toLowerCase().includes("task")).length;

export function computeHeaderStepperSteps(appState) {
  const state = appState || {};
  const processName = normalizeText(state.processName);
  const lanes = toArray(state.lanes);
  const nodes = toArray(state.nodes);
  const flows = toArray(state.flows);
  const mentorNotes = toArray(state.mentorNotes);
  const mentorRun = Boolean(state.mentorLastRunAt || state.mentorRun || mentorNotes.length);
  const hasHardFindings =
    mentorRun &&
    mentorNotes.some((note) => normalizeText(note?.severity).toUpperCase() === "HARD");

  const step1Done = processName.length > 0 && lanes.length > 0;
  const step2Done = (hasStartNode(nodes) && flows.length > 0) || nodes.length > 0;
  const step3Done = countTasks(nodes) >= 2;
  const step4Done = mentorRun || (!hasHardFindings && mentorNotes.length > 0);
  const step5Done = Boolean(state.storyGeneratedAt || state.storyCheckedAt);
  const step6Done = Boolean(state.lastSavedAt || state.lastExportedAt || state.validationPassed);

  const doneFlags = [step1Done, step2Done, step3Done, step4Done, step5Done, step6Done];
  let activeIndex = doneFlags.findIndex((done) => !done);
  if (activeIndex === -1) {
    activeIndex = doneFlags.length - 1;
  }

  return STEPS.map((step, index) => {
    const isDone = doneFlags[index];
    const isActive = index === activeIndex;
    const lineStatus = isDone ? "done" : "todo";
    return {
      ...step,
      isDone,
      isActive,
      lineStatus,
    };
  });
}
