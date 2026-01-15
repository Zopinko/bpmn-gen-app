from __future__ import annotations

from typing import Callable, Dict, List

from .rule_activity_is_isolated import check as rule_activity_is_isolated
from .rule_activity_name import check as rule_activity_name
from .rule_boundary_event_incoming import check as rule_boundary_event_incoming
from .rule_boundary_event_outgoing import check as rule_boundary_event_outgoing
from .rule_event_name import check as rule_event_name
from .rule_gateway_diverging import check as rule_gateway_diverging
from .rule_gateway_is_redundant import check as rule_gateway_is_redundant
from .rule_gateway_mixed import check as rule_gateway_mixed
from .rule_gateway_requires_incoming import check as rule_gateway_requires_incoming
from .rule_lane_empty import check as rule_lane_empty
from .rule_lane_missing_name import check as rule_lane_missing_name
from .rule_xor_outgoing_flow_names import check as rule_xor_outgoing_flow_names
from .rule_message_flow_pools import check as rule_message_flow_pools
from .rule_seqflow_pool import check as rule_seqflow_pool
from .rule_seqflow_subprocess import check as rule_seqflow_subprocess
from .rule_subprocess_start_event import check as rule_subprocess_start_event

RuleFunc = Callable[[Dict[str, object], object], List[object]]

RULES = [
    rule_seqflow_pool,
    rule_seqflow_subprocess,
    rule_message_flow_pools,
    rule_boundary_event_outgoing,
    rule_boundary_event_incoming,
    rule_subprocess_start_event,
    rule_gateway_mixed,
    rule_gateway_diverging,
    rule_gateway_is_redundant,
    rule_gateway_requires_incoming,
    rule_lane_empty,
    rule_lane_missing_name,
    rule_xor_outgoing_flow_names,
    rule_activity_is_isolated,
    rule_activity_name,
    rule_event_name,
]
