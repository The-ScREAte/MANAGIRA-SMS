// What each tool can change, by level (the Mira system prompt's "Actions"):
//   0  read: lookups, reports, PDFs to view, drafts that aren't saved or sent. Runs at once.
//   1  one small reversible change (an event, a document, a class, a saved report, one class's
//      attendance). Previews first; runs once the person confirms.
//   2  reaches people or many records (messages, reminders, posting, sharing, what families see,
//      bulk changes, enrollment). Previews with who and how many; runs once the person confirms.
//   3  high risk (deletes, promotions, closing a year group, admissions decisions, staff on hold).
//      Previews the impact; the person must also type what it is about ("delete Grade 6A").
// Every tool has a level: a new tool without one fails tests/actions.test.js. Read tools in
// tools/read/ are level 0 by construction.
const L0 = [
  "work_out_date",
  "report_builder_catalog", "run_report", "export_report", "draft_message", "draft_family_messages",
  "generate_report_card_summary", "generate_report_pdf", "generate_merit_sheet_pdf",
];
const L1 = [
  "save_report", "favorite_saved_report", "import_report_template", "add_to_my_calendar", "create_activity",
  "create_school_year", "rename_school_year", "add_term_to_school_year", "create_classes", "rename_class", "reorder_classes",
  "create_subject", "assign_subject_to_classes", "rename_subject", "create_graduation_year_group", "rename_graduation_year_group",
  "create_transport_bus", "set_transport_bus_status", "create_transport_route", "set_transport_route_status", "create_transport_stop",
  "create_transport_driver", "set_transport_driver_status", "create_transport_schedule", "set_transport_schedule_status",
  "assign_student_transportation", "remove_student_transportation", "create_event", "update_event",
  "upload_website_image", "update_website_section", "update_website_image", "create_website_article", "update_website_article", "update_website_about_us",
  "create_test", "modify_test", "set_test_status", "set_test_date_window", "set_test_questions", "review_question_set", "reuse_question_set",
  "set_student_assessment_status", "save_attempt_grade", "create_document", "set_document_title", "set_document_text", "set_sheet_cells",
  "resize_sheet", "insert_class_data_into_sheet", "remove_document_share", "unassign_document_from_class", "fix_failed_email",
  "update_pending_admission", "set_report_card_display_options", "set_grading_scale_band", "set_promotion_settings", "add_remark",
  "set_notification_preferences", "submit_feedback",
];
const L2 = [
  "share_saved_report", "schedule_saved_report", "remind_form_outstanding", "show_work_to_parents", "create_announcement",
  "set_enrollment_roster", "create_employee", "create_school_announcement", "update_school_announcement",
  "set_website_layout", "set_website_theme", "set_website_self_enrollment", "post_question_set_scores", "unpost_question_set_scores",
  "share_document_with_user", "assign_document_to_class", "create_students", "unarchive_students", "post_or_send_report_cards",
  "send_message", "cancel_scheduled_promotion", "set_organization_notification_preferences", "update_school_profile", "set_school_font",
  "set_display_preferences", "set_school_nickname", "set_student_id_settings",
];
const L3 = [
  "delete_saved_report", "delete_school_year", "delete_term", "delete_class", "delete_subject", "delete_graduation_year_group",
  "delete_enrollment", "schedule_promotion", "apply_scheduled_promotion", "reverse_promotion", "delete_reversed_promotion",
  "set_employee_hold", "delete_transport_bus", "delete_transport_route", "delete_transport_stop", "delete_transport_driver",
  "delete_transport_schedule", "delete_event", "delete_school_announcement", "delete_website_image", "delete_website_article",
  "delete_test", "delete_question_set", "delete_document", "approve_pending_admission", "reject_pending_admission",
  "delete_grading_scale_band", "delete_remark", "close_graduation_year_group",
];

const LEVELS = {};
[[0, L0], [1, L1], [2, L2], [3, L3]].forEach(([level, names]) => names.forEach((name) => {
  if (name in LEVELS) throw new Error(`${name} has two levels`);
  LEVELS[name] = level;
}));

const READ_NAME = /^(get_|list_|find_|check_|compare_|whats_|search_)/;

// The level of a registered tool: its own (read tools: 0), a read-named tool 0, else the list.
function levelOf(name, tool) {
  if (tool && Number.isInteger(tool.level)) return tool.level;
  if (name in LEVELS) return LEVELS[name];
  if (READ_NAME.test(name)) return 0;
  return null;
}

module.exports = { LEVELS, levelOf, READ_NAME };
