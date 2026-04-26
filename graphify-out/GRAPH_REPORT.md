# Graph Report - C:\projekty\bpmn-gen-app  (2026-04-12)

## Corpus Check
- 147 files · ~181,307 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 966 nodes · 1651 edges · 123 communities detected
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 105 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_backend UnsupportedProposalType|backend: UnsupportedProposalType]]
- [[_COMMUNITY_backend Deterministically build a linear engine_json from a wizard payload without any A|backend: Deterministically build a linear engine_json from a wizard payload without any A]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend FrajerKB|backend: FrajerKB]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend MentorApplyConflict|backend: MentorApplyConflict]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend Prejde z targetu flow ÄŹalej, kĂ˝m nenĂˇjde prvĂ˝ task (preskoÄŤĂ­ eventgateway|backend: Prejde z targetu flow ÄŹalej, kĂ˝m nenĂˇjde prvĂ˝ task (preskoÄŤĂ­ event/gateway]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend AuthConfig|backend: AuthConfig]]
- [[_COMMUNITY_backend AICreativeSettings|backend: AICreativeSettings]]
- [[_COMMUNITY_backend MentorIndex|backend: MentorIndex]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend EditorPresence|backend: EditorPresence]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend Issue|backend: Issue]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend NodeIssue|backend: NodeIssue]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_main.py|main.py]]
- [[_COMMUNITY_temp_provider.py|temp_provider.py]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_backend|backend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]
- [[_COMMUNITY_frontend|frontend]]

## God Nodes (most connected - your core abstractions)
1. `_engine()` - 30 edges
2. `_by_rule()` - 30 edges
3. `AuthUser` - 24 edges
4. `_resolve_org_id()` - 18 edges
5. `FrajerKB` - 16 edges
6. `LinearWizardRequest` - 14 edges
7. `_read_tree()` - 14 edges
8. `generateProcessStory()` - 14 edges
9. `apply_proposals()` - 13 edges
10. `LaneAppendRequest` - 13 edges

## Surprising Connections (you probably didn't know these)
- `MentorApplyConflict` --uses--> `MentorApplyAudit`  [INFERRED]
  backend\mentor\applier.py → backend\mentor\models.py
- `MentorApplyConflict` --uses--> `MentorApplyRequest`  [INFERRED]
  backend\mentor\applier.py → backend\mentor\models.py
- `MentorApplyConflict` --uses--> `MentorApplyResponse`  [INFERRED]
  backend\mentor\applier.py → backend\mentor\models.py
- `MentorApplyConflict` --uses--> `Proposal`  [INFERRED]
  backend\mentor\applier.py → backend\mentor\models.py
- `MentorIndex` --uses--> `MentorFinding`  [INFERRED]
  backend\mentor\rule_engine.py → backend\mentor\models.py

## Communities

### Community 0 - "backend: UnsupportedProposalType"
Cohesion: 0.05
Nodes (79): UnsupportedProposalType, change_password_logged_in(), ChangePasswordRequest, _clear_session_cookie(), _enforce_rate_limit(), forgot_password(), ForgotPasswordRequest, _get_client_ip() (+71 more)

### Community 1 - "backend: Deterministically build a linear engine_json from a wizard payload without any A"
Cohesion: 0.08
Nodes (43): _add_di(), _add_event_definition(), append_tasks_to_lane_from_description(), _build_layout(), build_linear_engine_from_wizard(), _expand_conditional_step(), _expand_parallel_step(), generate_bpmn_from_json() (+35 more)

### Community 2 - "frontend"
Cohesion: 0.08
Nodes (31): analyzeLaneLine(), analyzeLaneLines(), buildFlowAdjacency(), buildGuideIndex(), countParallelHintItems(), detectDecision(), detectParallel(), determineGuidePhase() (+23 more)

### Community 3 - "backend"
Cohesion: 0.1
Nodes (36): accept_org_invite(), add_org_member(), authenticate_user(), change_password(), confirm_password_reset(), count_org_owners(), create_org_invite(), create_org_with_owner() (+28 more)

### Community 4 - "backend: FrajerKB"
Cohesion: 0.11
Nodes (24): FrajerKB, KB-driven parser + heuristics for Frajer., _uuid(), _build_artifacts_from_engine(), _build_engine_json_with_kb(), _build_preview_artifacts(), _coerce_bool(), frajer_debug_parse() (+16 more)

### Community 5 - "frontend"
Cohesion: 0.06
Nodes (0): 

### Community 6 - "frontend"
Cohesion: 0.13
Nodes (30): applyMainFlowConnectors(), asSorted(), buildBranchSteps(), buildDecisionLines(), buildDecisionNarrative(), buildIndex(), buildLine(), buildNarrativeParagraphs() (+22 more)

### Community 7 - "backend"
Cohesion: 0.18
Nodes (31): _by_rule(), _engine(), test_activity_is_isolated_invalid(), test_activity_is_isolated_valid(), test_boundary_event_max_one_outgoing_invalid(), test_boundary_event_max_one_outgoing_valid(), test_boundary_event_no_incoming_invalid(), test_boundary_event_no_incoming_valid() (+23 more)

### Community 8 - "backend: MentorApplyConflict"
Cohesion: 0.16
Nodes (24): _add_value(), _apply_alias(), _apply_json_patch(), _apply_label_rule(), apply_proposals(), _decode_pointer(), _deduplicate_aliases(), _ensure_kb_dir() (+16 more)

### Community 9 - "backend"
Cohesion: 0.25
Nodes (22): _assert_folder(), _create_empty_process_model(), create_folder(), create_process(), create_process_from_org_model(), _default_root(), delete_node(), delete_org_storage() (+14 more)

### Community 10 - "backend: Prejde z targetu flow ÄŹalej, kĂ˝m nenĂˇjde prvĂ˝ task (preskoÄŤĂ­ event/gateway"
Cohesion: 0.15
Nodes (19): align_gateway_lanes(), _build_degrees(), _build_graph(), _extract_cond_then(), _extract_cond_then_else(), _is_generic_task_name(), _is_task_type(), _locale_join_label() (+11 more)

### Community 11 - "backend"
Cohesion: 0.31
Nodes (14): _by_type(), _demo_engine(), test_build_linear_engine_from_wizard_creates_chain(), test_lane_append_conditional_keeps_single_task_when_and_is_not_new_step(), test_lane_append_conditional_splits_last_and_in_branch_into_extra_step(), test_lane_append_conditional_splits_multiple_tasks_per_branch(), test_lane_append_continues_after_parallel_join_not_last_branch_task(), test_lane_append_inline_decision_after_linear_steps() (+6 more)

### Community 12 - "backend"
Cohesion: 0.26
Nodes (14): delete_model(), get_user_models_dir(), list_models(), load_model(), _model_path(), _models_dir(), _now_iso(), Override storage directory (useful for tests). (+6 more)

### Community 13 - "backend"
Cohesion: 0.21
Nodes (14): _apply_unicode_normalization(), _build_ix(), normalize_engine_payload(), _normalize_node_type(), _postprocess_engine_json(), prepare_for_bpmn(), Apply label cleanup and structural post-processing prior to layout., Mutate *node* so its type matches canonical BPMN aliases. (+6 more)

### Community 14 - "backend"
Cohesion: 0.43
Nodes (13): _authed_client(), _expire_invite(), _make_client(), _restore_env(), _set_env(), test_already_member_acceptance_is_graceful_and_marks_invite_used(), test_existing_active_invite_returns_same_public_token(), test_generated_invite_is_active_with_expiry() (+5 more)

### Community 15 - "backend"
Cohesion: 0.22
Nodes (7): ensure_org_invite_secret_configured(), expires_in(), make_org_invite_public_token(), _org_invite_signing_secret(), parse_org_invite_public_token(), to_iso_z(), utcnow()

### Community 16 - "backend"
Cohesion: 0.36
Nodes (12): create_org_folder(), create_org_process(), create_org_process_from_org_model(), delete_org_node(), get_org_model(), get_org_model_presence(), heartbeat_org_model_presence(), move_org_node() (+4 more)

### Community 17 - "backend"
Cohesion: 0.47
Nodes (12): _authed_client(), _make_client(), _restore_env(), _set_env(), test_last_owner_cannot_leave_org(), test_member_can_leave_joined_org(), test_org_scoped_endpoints_validate_membership_and_selected_org(), test_owner_can_join_other_orgs_and_have_multiple_memberships() (+4 more)

### Community 18 - "frontend"
Cohesion: 0.29
Nodes (12): createOrgFolder(), createOrgProcess(), createOrgProcessFromOrgModel(), deleteOrgNode(), getOrgModel(), getOrgModelPresence(), heartbeatOrgModelPresence(), moveOrgNode() (+4 more)

### Community 19 - "backend"
Cohesion: 0.5
Nodes (11): _authed_client(), _make_client(), _restore_env(), _set_env(), test_create_process_from_org_model_requires_existing_same_org_model(), test_member_cannot_delete_org_process(), test_org_presence_lists_active_editor_for_process_node(), test_org_process_creation_stores_model_in_org_scope() (+3 more)

### Community 20 - "backend"
Cohesion: 0.18
Nodes (0): 

### Community 21 - "frontend"
Cohesion: 0.2
Nodes (2): AdminDetailDrawer(), formatDateTimeValue()

### Community 22 - "backend"
Cohesion: 0.42
Nodes (9): _check_control_tokens(), _contains_any(), determine_node_type(), _heuristics(), _match_lexicon(), _normalize(), _parse_timer_value(), Vráti dict s typom uzla. Nikdy nevracia None – fallback je 'task'.     Príklady (+1 more)

### Community 23 - "backend"
Cohesion: 0.36
Nodes (9): delete_project_notes(), _ensure_dir(), has_legacy_global_notes(), _load_notes_from_path(), load_project_notes(), _org_notes_path(), _resolve_legacy_notes_path(), _resolve_notes_base_dir() (+1 more)

### Community 24 - "backend"
Cohesion: 0.5
Nodes (8): _activity_log_path(), get_org_event(), get_org_request_resolution(), list_org_events(), _load_events(), _models_dir(), record_org_event(), _safe_org_id()

### Community 25 - "backend"
Cohesion: 0.44
Nodes (8): _base_models_dir(), list_org_models(), load_org_model(), _now_iso(), org_model_path(), org_models_dir(), save_org_model(), save_org_model_copy()

### Community 26 - "backend"
Cohesion: 0.58
Nodes (8): _authed_client(), _make_client(), _restore_env(), _set_env(), test_member_cannot_approve_delete_request(), test_org_activity_lists_key_events(), test_owner_can_approve_delete_request_and_process_is_removed(), test_owner_can_reject_delete_request_without_removing_process()

### Community 27 - "frontend"
Cohesion: 0.42
Nodes (8): changePassword(), getMe(), loginAuth(), logoutAuth(), registerAuth(), request(), requestPasswordReset(), resetPassword()

### Community 28 - "backend"
Cohesion: 0.36
Nodes (4): is_super_admin_email(), is_super_admin_user(), require_super_admin(), _super_admin_allowlist()

### Community 29 - "backend: AuthConfig"
Cohesion: 0.54
Nodes (7): AuthConfig, _env(), _env_int(), get_auth_config(), _is_production(), _required_env_in_production(), _split_csv()

### Community 30 - "backend: AICreativeSettings"
Cohesion: 0.29
Nodes (5): AICreativeSettings, AppSettings, _get_lower_str(), _get_str(), MentorAISettings

### Community 31 - "backend: MentorIndex"
Cohesion: 0.5
Nodes (7): build_index(), MentorIndex, _normalize_flow_type(), _normalize_node_type(), _pick_first(), run_rules(), _tokenize()

### Community 32 - "backend"
Cohesion: 0.36
Nodes (7): _find_lexicon_path(), get_lexicon(), _normalize_phrases(), Return the value without diacritics so ASCII variants can match., Lowercase phrases and add ASCII duplicates when they differ., Load and normalize the YAML lexicon for the given language., _strip_diacritics()

### Community 33 - "backend"
Cohesion: 0.29
Nodes (2): _by_type(), test_simple_linear_draft()

### Community 34 - "backend"
Cohesion: 0.61
Nodes (7): _authed_client(), _make_client(), _restore_env(), _set_env(), test_member_can_read_and_update_org_notes(), test_non_member_cannot_access_foreign_org_notes(), test_notes_are_scoped_per_organization()

### Community 35 - "scripts"
Cohesion: 0.46
Nodes (7): add_membership(), connect(), find_org_id(), find_user_id(), has_membership(), main(), resolve_db_path()

### Community 36 - "scripts"
Cohesion: 0.46
Nodes (7): _connect(), _db_path(), delete_org(), list_orgs(), main(), _models_base_dir(), prompt_yes_no()

### Community 37 - "backend"
Cohesion: 0.57
Nodes (6): detect_conflicts(), kpi_delta(), lint_kb(), _load_yaml(), _normalize_alias_token(), validate_kb_version()

### Community 38 - "backend"
Cohesion: 0.38
Nodes (3): is_event_token(), is_gateway_token(), target_type_for_node()

### Community 39 - "backend"
Cohesion: 0.48
Nodes (5): list_admin_models(), list_admin_orgs(), _models_base_dir(), _org_model_counts(), _org_model_items()

### Community 40 - "backend: EditorPresence"
Cohesion: 0.57
Nodes (6): clear_editor_presence(), EditorPresence, heartbeat_editor_presence(), list_org_editor_presence(), _prune_expired(), _utcnow()

### Community 41 - "backend"
Cohesion: 0.71
Nodes (6): _count(), _has_seq_flow(), _root(), test_and_split_join(), test_inclusive_split_join(), test_xor_split_join()

### Community 42 - "backend"
Cohesion: 0.71
Nodes (6): _make_client(), _sample_engine(), _setup_tmp_dir(), test_create_and_get_model(), test_list_search_and_delete_models(), test_rename_model()

### Community 43 - "backend"
Cohesion: 0.6
Nodes (5): _csv_env(), _required_env(), send_password_reset_email(), _send_via_smtp(), _smtp_security_mode()

### Community 44 - "backend"
Cohesion: 0.53
Nodes (5): draft_engine_json_from_text(), _new_id(), _normalize_lane_name(), _split_sentences(), _trim_name()

### Community 45 - "backend"
Cohesion: 0.53
Nodes (5): get_kb(), _load_json_candidates(), _load_yaml_candidates(), Load KB assets with optional variant fallback.      If a variant-specific file i, _variant_filenames()

### Community 46 - "frontend"
Cohesion: 0.6
Nodes (5): computeHeaderStepperSteps(), countTasks(), hasStartNode(), normalizeText(), toArray()

### Community 47 - "frontend"
Cohesion: 0.33
Nodes (0): 

### Community 48 - "frontend"
Cohesion: 0.33
Nodes (0): 

### Community 49 - "backend"
Cohesion: 0.7
Nodes (4): _build_components(), check(), _is_sequence_flow(), _is_start_event()

### Community 50 - "backend"
Cohesion: 0.7
Nodes (4): check(), _compute_levels(), _is_end_event(), _normalize()

### Community 51 - "backend"
Cohesion: 0.7
Nodes (4): check(), _flow_label(), _is_default_flow(), _is_xor_gateway()

### Community 52 - "backend"
Cohesion: 0.4
Nodes (0): 

### Community 53 - "backend: Issue"
Cohesion: 0.6
Nodes (4): Issue, _norm_type(), Run controller-level BPMN checks and return validation issues., validate()

### Community 54 - "backend"
Cohesion: 0.4
Nodes (0): 

### Community 55 - "frontend"
Cohesion: 0.7
Nodes (4): getAdminModels(), getAdminOrgs(), getAdminUsers(), request()

### Community 56 - "backend"
Cohesion: 0.83
Nodes (3): _db_path(), get_connection(), run_auth_migrations()

### Community 57 - "backend: NodeIssue"
Cohesion: 0.83
Nodes (3): _flows_by_node(), NodeIssue, validate_engine()

### Community 58 - "frontend"
Cohesion: 0.5
Nodes (0): 

### Community 59 - "frontend"
Cohesion: 0.67
Nodes (2): isNoBranchLabel(), normalizeBranchLabel()

### Community 60 - "frontend"
Cohesion: 0.83
Nodes (3): getOrgCapabilities(), getOrgRoleLabel(), normalizeOrgRole()

### Community 61 - "backend"
Cohesion: 1.0
Nodes (2): create_app(), mount_playground()

### Community 62 - "backend"
Cohesion: 0.67
Nodes (0): 

### Community 63 - "backend"
Cohesion: 1.0
Nodes (2): bpmn_xml_to_engine(), _local()

### Community 64 - "backend"
Cohesion: 1.0
Nodes (2): find_gateway_warnings(), gateway_degrees()

### Community 65 - "backend"
Cohesion: 1.0
Nodes (2): atomic_write_json(), atomic_write_text()

### Community 66 - "backend"
Cohesion: 0.67
Nodes (0): 

### Community 67 - "backend"
Cohesion: 0.67
Nodes (0): 

### Community 68 - "backend"
Cohesion: 0.67
Nodes (0): 

### Community 69 - "backend"
Cohesion: 0.67
Nodes (0): 

### Community 70 - "backend"
Cohesion: 1.0
Nodes (2): _sample_engine(), test_export_bpmn_download_response()

### Community 71 - "frontend"
Cohesion: 0.67
Nodes (0): 

### Community 72 - "frontend"
Cohesion: 0.67
Nodes (0): 

### Community 73 - "frontend"
Cohesion: 0.67
Nodes (0): 

### Community 74 - "frontend"
Cohesion: 0.67
Nodes (0): 

### Community 75 - "frontend"
Cohesion: 0.67
Nodes (0): 

### Community 76 - "scripts"
Cohesion: 1.0
Nodes (2): get_db_path(), main()

### Community 77 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 85 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 86 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 87 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 88 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 89 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 90 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 91 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 92 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 93 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 94 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 95 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 96 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 97 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 98 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 99 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 100 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 101 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 102 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 103 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 104 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 105 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 106 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 107 - "main.py"
Cohesion: 1.0
Nodes (0): 

### Community 108 - "temp_provider.py"
Cohesion: 1.0
Nodes (0): 

### Community 109 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 110 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 111 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 112 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 113 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 114 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 115 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 116 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 117 - "backend"
Cohesion: 1.0
Nodes (0): 

### Community 118 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 119 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 120 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 121 - "frontend"
Cohesion: 1.0
Nodes (0): 

### Community 122 - "frontend"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **23 isolated node(s):** `MentorAISettings`, `AICreativeSettings`, `AppSettings`, `KB-driven parser + heuristics for Frajer.`, `Load KB assets with optional variant fallback.      If a variant-specific file i` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `backend`** (2 nodes): `config.py`, `apply_cors()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `telemetry.py`, `submit_telemetry()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_activity_is_isolated.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_activity_name.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_boundary_event_incoming.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_boundary_event_outgoing.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_event_name.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_gateway_diverging.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_gateway_is_redundant.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_gateway_mixed.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_gateway_requires_incoming.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_lane_empty.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_lane_missing_name.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_message_flow_pools.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_seqflow_pool.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_seqflow_subprocess.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_subprocess_start_event.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `rule_text_annotation_empty.py`, `check()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `controller_router.py`, `validate_endpoint()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `telemetry_router.py`, `submit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (2 nodes): `test_engine_ids.py`, `test_generate_bpmn_includes_engine_ids()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `trackSignupCompleted()`, `analytics.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `AiModeSwitch()`, `AiModeSwitch.jsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `HeaderStepper.jsx`, `HeaderStepper()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `OverlayLegend.jsx`, `OverlayLegend()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `RightPaneSplit.jsx`, `RightPaneSplit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `AccountPage()`, `AccountPage.jsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `OrganizationPage.jsx`, `OrganizationPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `RegisterPage.jsx`, `RegisterPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (2 nodes): `relayoutScheduler.js`, `createRelayoutScheduler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `main.py`** (1 nodes): `main.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `temp_provider.py`** (1 nodes): `temp_provider.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `backend`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (1 nodes): `eslint.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (1 nodes): `vite.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (1 nodes): `i18n.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (1 nodes): `main.jsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `frontend`** (1 nodes): `fixtures.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MentorApplyConflict` connect `backend: MentorApplyConflict` to `backend: UnsupportedProposalType`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `MentorAISettings`, `AICreativeSettings`, `AppSettings` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `backend: UnsupportedProposalType` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `backend: Deterministically build a linear engine_json from a wizard payload without any A` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `backend` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `backend: FrajerKB` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._