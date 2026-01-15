const STEPS = [
  {
    id: "basic",
    label: "Základ",
    tooltip: "Názov procesu, lanes a spúšťač.",
  },
  {
    id: "flow",
    label: "Tok procesu",
    tooltip: "Vytvor základný tok, aby mapa mala kostru.",
  },
  {
    id: "activities",
    label: "Aktivity",
    tooltip: "Doplň úlohy a rozhodnutia do lanes.",
  },
  {
    id: "review",
    label: "Kontrola",
    tooltip: "Spusti mentora a oprav zistené problémy.",
  },
  {
    id: "done",
    label: "Hotovo",
    tooltip: "Ulož alebo exportuj hotový model.",
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
  const step5Done = Boolean(state.lastSavedAt || state.lastExportedAt || state.validationPassed);

  const doneFlags = [step1Done, step2Done, step3Done, step4Done, step5Done];
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
