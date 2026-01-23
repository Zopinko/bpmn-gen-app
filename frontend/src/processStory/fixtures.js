export const fixtureLinear = {
  processId: "Process_1",
  name: "Sample process",
  lanes: [{ id: "lane_sales", name: "Sales" }],
  nodes: [
    { id: "start_1", type: "startEvent", name: "request is received", laneId: "lane_sales" },
    { id: "task_1", type: "task", name: "validate request", laneId: "lane_sales" },
    { id: "end_1", type: "endEvent", name: "request completed", laneId: "lane_sales" },
  ],
  flows: [
    { id: "flow_start_to_task", source: "start_1", target: "task_1" },
    { id: "flow_task_to_end", source: "task_1", target: "end_1" },
  ],
};

export const fixtureXor = {
  processId: "Process_2",
  name: "Decision process",
  lanes: [
    { id: "lane_ops", name: "Operations" },
    { id: "lane_fin", name: "Finance" },
  ],
  nodes: [
    { id: "start_1", type: "startEvent", name: "request arrives", laneId: "lane_ops" },
    { id: "task_1", type: "task", name: "check eligibility", laneId: "lane_ops" },
    { id: "xor_1", type: "exclusiveGateway", name: "Approved?", laneId: "lane_ops" },
    { id: "task_2", type: "task", name: "prepare offer", laneId: "lane_fin" },
    { id: "task_3", type: "task", name: "send rejection", laneId: "lane_ops" },
    { id: "end_1", type: "endEvent", name: "process ends", laneId: "lane_ops" },
    { id: "end_2", type: "endEvent", name: "process ends", laneId: "lane_fin" },
  ],
  flows: [
    { id: "flow_start_to_task", source: "start_1", target: "task_1" },
    { id: "flow_task_to_xor", source: "task_1", target: "xor_1" },
    { id: "flow_xor_yes", source: "xor_1", target: "task_2", name: "approved" },
    { id: "flow_xor_no", source: "xor_1", target: "task_3", name: "rejected" },
    { id: "flow_task2_to_end", source: "task_2", target: "end_2" },
    { id: "flow_task3_to_end", source: "task_3", target: "end_1" },
  ],
};
