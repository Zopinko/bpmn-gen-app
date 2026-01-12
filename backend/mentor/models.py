from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ConfigDict


class JsonPatchOp(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    op: Literal["add", "remove", "replace", "move", "copy", "test"]
    path: str
    from_path: Optional[str] = Field(default=None, alias="from")
    value: Optional[Any] = None


class ProposalMatchPattern(BaseModel):
    value: str
    mode: str


class ProposalMatch(BaseModel):
    locale: Optional[str] = None
    patterns: List[ProposalMatchPattern] = Field(default_factory=list)
    context: List[str] = Field(default_factory=list)


class ProposalAction(BaseModel):
    op: str
    params: Optional[Dict[str, Any]] = None


class ProposalAnnotation(BaseModel):
    node_id: str = Field(alias="nodeId")
    title: str
    description: Optional[str] = None
    severity: Literal["info", "success", "warning", "error"] = "warning"
    tags: List[str] = Field(default_factory=list)
    id: Optional[str] = None


class Proposal(BaseModel):
    id: str
    type: Literal[
        "label_rule",
        "alias",
        "template",
        "naming_rule",
        "join_hint",
        "remove_rule",
        "engine_patch",
    ]
    summary: str
    match: ProposalMatch
    targets: List[str] = Field(default_factory=list)
    action: ProposalAction
    engine_patch: Optional[List[JsonPatchOp]] = None
    annotations: List[ProposalAnnotation] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    risk: Literal["low", "medium", "high"] = "low"
    evidence: List[str] = Field(default_factory=list)
    rollback_hint: Optional[str] = None
    source: Optional[str] = None


class MentorTarget(BaseModel):
    id: str
    type: Literal[
        "task",
        "event",
        "gateway",
        "sequenceFlow",
        "messageFlow",
        "lane",
        "subprocess",
        "unknown",
    ]


class MentorFinding(BaseModel):
    id: str
    severity: Literal["HARD", "SOFT", "INFO"]
    target: MentorTarget
    message: str
    proposal: str
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    risk: Literal["model_invalid", "semantic_change", "cosmetic"]
    autofix: bool = False
    fix_payload: Optional[Dict[str, Any]] = None


class TelemetryEvent(BaseModel):
    name: str
    value: Optional[Any] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Telemetry(BaseModel):
    metrics: Dict[str, Any] = Field(default_factory=dict)
    events: List[TelemetryEvent] = Field(default_factory=list)
    tags: Dict[str, str] = Field(default_factory=dict)


class MentorReviewRequest(BaseModel):
    text: Optional[str] = None
    engine_json: Optional[Dict[str, Any]] = None
    kb_version: Optional[str] = None
    telemetry: Optional[Telemetry] = None
    telemetry_id: Optional[str] = None


class MentorReviewResponse(BaseModel):
    findings: List[MentorFinding] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class MentorEngineApplyAuditEntry(BaseModel):
    id: str
    action: str
    reason: str


class MentorEngineApplyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    engine_json: Dict[str, Any]
    accepted_finding_ids: List[str] = Field(
        default_factory=list, alias="acceptedFindingIds"
    )
    fix_payload_overrides: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict, alias="fixPayloadOverrides"
    )
    findings: Optional[List[MentorFinding]] = None


class MentorEngineApplyResponse(BaseModel):
    engine_json: Dict[str, Any]
    audit_log: List[MentorEngineApplyAuditEntry] = Field(default_factory=list)


class MentorApplyRequest(BaseModel):
    proposals: List[Proposal] = Field(default_factory=list)
    base_kb_version: Optional[str] = None
    engine_json: Optional[Dict[str, Any]] = None


class MentorApplyAudit(BaseModel):
    commit_id: Optional[str] = None
    pr_url: Optional[str] = None


class MentorApplyResponse(BaseModel):
    new_kb_version: str
    audit: MentorApplyAudit
    patched_engine_json: Optional[Dict[str, Any]] = None


class ValidationRequest(BaseModel):
    kb_version: Optional[str] = None


class ValidationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    pass_state: bool = Field(alias="pass")
    kpi_delta: Dict[str, Any] = Field(default_factory=dict)
    conflicts: List[Dict[str, Any]] = Field(default_factory=list)


class ABEvaluationResponse(BaseModel):
    base: int
    candidate: int
    delta: Dict[str, Any] = Field(default_factory=dict)


class TelemetrySubmission(BaseModel):
    run_id: str
    kb_version: str
    telemetry: Telemetry
    text_segments: Optional[List[str]] = None


class TelemetrySubmitResponse(BaseModel):
    status: str = "ok"
