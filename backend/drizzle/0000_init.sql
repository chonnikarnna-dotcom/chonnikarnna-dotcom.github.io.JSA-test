CREATE TYPE "public"."approval_decision" AS ENUM('SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_stage" AS ENUM('AREA_OWNER', 'SAFETY_OFFICER');--> statement-breakpoint
CREATE TYPE "public"."control_type" AS ENUM('EXISTING', 'ADDITIONAL');--> statement-breakpoint
CREATE TYPE "public"."instance_status" AS ENUM('IN_PROGRESS', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."jsa_status" AS ENUM('DRAFT', 'SUBMITTED', 'PENDING_AREA_OWNER', 'PENDING_SAFETY_OFFICER', 'RETURNED', 'REJECTED', 'APPROVED', 'CANCELLED', 'EXPIRED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."matrix_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."permit_verification_status" AS ENUM('MANUAL_REFERENCE', 'AWAITING_VERIFICATION', 'VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."risk_phase" AS ENUM('INITIAL', 'RESIDUAL');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('PENDING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."token_type" AS ENUM('INVITE', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('EMPLOYEE', 'CONTRACTOR');--> statement-breakpoint
CREATE TABLE "approval_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid,
	"jsa_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"stage" "approval_stage",
	"decision" "approval_decision" NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"comment" text,
	"metadata" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jsa_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" "instance_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"current_step_order" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"workflow_step_id" uuid NOT NULL,
	"stage" "approval_stage" NOT NULL,
	"assignee_id" uuid,
	"status" "task_status" DEFAULT 'PENDING' NOT NULL,
	"decision" "approval_decision",
	"acted_by_id" uuid,
	"comment" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"stage" "approval_stage" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "approval_workflows_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "area_owner_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"area_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_backup" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" text,
	"result" varchar(20) NOT NULL,
	"reason" text,
	"request_id" varchar(64),
	"ip" text,
	"metadata" jsonb,
	"prev_hash" varchar(64),
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_companies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "control_measure_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"hierarchy" text NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_measure_master_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "factory_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"building" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factory_areas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "factory_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factory_sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "hazard_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"category" text NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hazard_master_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "job_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"default_permit_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "jsa_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jsa_id" uuid NOT NULL,
	"added_in_version" integer NOT NULL,
	"removed_in_version" integer,
	"category" varchar(40) DEFAULT 'OTHER' NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" varchar(200) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"uploaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jsa_attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "jsa_control_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hazard_id" uuid NOT NULL,
	"type" "control_type" NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"declaration_version" varchar(20) NOT NULL,
	"language" varchar(5) NOT NULL,
	"text_snapshot" text NOT NULL,
	"accepted_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_job_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"activity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_permit_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"permit_type_id" uuid NOT NULL,
	"reference_no" text,
	"verification_status" "permit_verification_status" DEFAULT 'MANUAL_REFERENCE' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attachment_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "jsa_permit_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permit_ref_id" uuid NOT NULL,
	"verified_by_id" uuid NOT NULL,
	"note" text,
	"verified_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_reference_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hazard_id" uuid NOT NULL,
	"phase" "risk_phase" NOT NULL,
	"severity" integer NOT NULL,
	"likelihood" integer NOT NULL,
	"score" integer NOT NULL,
	"level_code" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jsa_id" uuid NOT NULL,
	"from_status" "jsa_status",
	"to_status" "jsa_status" NOT NULL,
	"version_no" integer NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jsa_step_hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"hazard" text NOT NULL,
	"consequence" text NOT NULL,
	"hazard_master_id" uuid,
	"control_owner" text
);
--> statement-breakpoint
CREATE TABLE "jsa_validity_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" varchar(30) DEFAULT 'END_OF_WORK' NOT NULL,
	"duration_hours" integer DEFAULT 24 NOT NULL,
	"max_work_period_days" integer DEFAULT 30 NOT NULL,
	"expiry_reminder_hours" integer DEFAULT 24 NOT NULL,
	"completion_tracking_enabled" boolean DEFAULT true NOT NULL,
	"min_lead_time_hours" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "jsa_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jsa_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"job_description" text DEFAULT '' NOT NULL,
	"requester_name" text NOT NULL,
	"requester_type" "user_type" NOT NULL,
	"department_id" uuid,
	"contractor_company_id" uuid,
	"contact_phone" text,
	"contact_email" text,
	"site_id" uuid,
	"area_id" uuid,
	"exact_location" text,
	"planned_start" timestamp (3) with time zone,
	"planned_end" timestamp (3) with time zone,
	"worker_count" integer,
	"supervisor_name" text,
	"supervisor_phone" text,
	"job_type_id" uuid,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"ppe_required" text[] DEFAULT '{}'::text[] NOT NULL,
	"additional_requirements" text,
	"risk_matrix_version_id" uuid,
	"content_hash" varchar(128),
	"change_summary" jsonb,
	"revision_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "jsas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_no" varchar(30) NOT NULL,
	"status" "jsa_status" DEFAULT 'DRAFT' NOT NULL,
	"requester_id" uuid NOT NULL,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"current_version_no" integer DEFAULT 1 NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"area_id" uuid,
	"department_id" uuid,
	"contractor_company_id" uuid,
	"job_type_id" uuid,
	"planned_start" timestamp (3) with time zone,
	"planned_end" timestamp (3) with time zone,
	"max_initial_risk_score" integer,
	"max_residual_risk_score" integer,
	"risk_level_code" varchar(30),
	"initial_risk_level_code" varchar(30),
	"is_high_risk_work" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp (3) with time zone,
	"approved_at" timestamp (3) with time zone,
	"valid_from" timestamp (3) with time zone,
	"valid_until" timestamp (3) with time zone,
	"expiry_reminder_sent_at" timestamp (3) with time zone,
	"cancelled_at" timestamp (3) with time zone,
	"cancel_reason" text,
	"completed_at" timestamp (3) with time zone,
	"completed_by_id" uuid,
	"completion_note" text,
	"deleted_at" timestamp (3) with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jsas_reference_no_unique" UNIQUE("reference_no")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(60) NOT NULL,
	"channel" varchar(20) DEFAULT 'IN_APP' NOT NULL,
	"language" varchar(5) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"jsa_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "permit_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"is_high_risk" boolean DEFAULT true NOT NULL,
	"requires_permit_reference" boolean DEFAULT true NOT NULL,
	"requires_attachment" boolean DEFAULT false NOT NULL,
	"requires_safety_verification" boolean DEFAULT true NOT NULL,
	"follow_up_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guidance_en" text,
	"guidance_th" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permit_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "report_export_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_type" varchar(60) NOT NULL,
	"format" varchar(10) NOT NULL,
	"filters" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_acceptance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matrix_version_id" uuid NOT NULL,
	"max_acceptable_residual_score" integer NOT NULL,
	"block_submission" boolean DEFAULT false NOT NULL,
	"block_final_approval" boolean DEFAULT true NOT NULL,
	"require_residual_lower_or_equal" boolean DEFAULT true NOT NULL,
	"description" text,
	CONSTRAINT "risk_acceptance_rules_matrix_version_id_unique" UNIQUE("matrix_version_id")
);
--> statement-breakpoint
CREATE TABLE "risk_matrix_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matrix_version_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	"min_score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"color" varchar(20) NOT NULL,
	"sort_order" integer NOT NULL,
	"requires_escalation" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_matrix_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_no" integer NOT NULL,
	"name" text NOT NULL,
	"status" "matrix_status" DEFAULT 'DRAFT' NOT NULL,
	"size" integer DEFAULT 5 NOT NULL,
	"score_method" varchar(20) DEFAULT 'MULTIPLY' NOT NULL,
	"severity_labels" jsonb NOT NULL,
	"likelihood_labels" jsonb NOT NULL,
	"is_validated" boolean DEFAULT false NOT NULL,
	"validated_by_id" uuid,
	"validated_at" timestamp (3) with time zone,
	"activated_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_matrix_versions_version_no_unique" UNIQUE("version_no")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_en" text NOT NULL,
	"name_th" text NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "safety_officer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"user_id" uuid NOT NULL,
	"is_backup" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"csrf_token" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "token_type" NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"used_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"phone" text,
	"user_type" "user_type" DEFAULT 'EMPLOYEE' NOT NULL,
	"department_id" uuid,
	"contractor_company_id" uuid,
	"preferred_language" varchar(5) DEFAULT 'th' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp (3) with time zone,
	"invited_at" timestamp (3) with time zone,
	"activated_at" timestamp (3) with time zone,
	"last_login_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_instance_id_approval_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."approval_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_version_id_jsa_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."jsa_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_history" ADD CONSTRAINT "approval_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_version_id_jsa_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."jsa_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instance_id_approval_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."approval_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_workflow_step_id_approval_workflow_steps_id_fk" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."approval_workflow_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_acted_by_id_users_id_fk" FOREIGN KEY ("acted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflow_steps" ADD CONSTRAINT "approval_workflow_steps_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_owner_assignments" ADD CONSTRAINT "area_owner_assignments_area_id_factory_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."factory_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_owner_assignments" ADD CONSTRAINT "area_owner_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_areas" ADD CONSTRAINT "factory_areas_site_id_factory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."factory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_attachments" ADD CONSTRAINT "jsa_attachments_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_attachments" ADD CONSTRAINT "jsa_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_control_measures" ADD CONSTRAINT "jsa_control_measures_hazard_id_jsa_step_hazards_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "public"."jsa_step_hazards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_declarations" ADD CONSTRAINT "jsa_declarations_version_id_jsa_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."jsa_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_declarations" ADD CONSTRAINT "jsa_declarations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_job_steps" ADD CONSTRAINT "jsa_job_steps_version_id_jsa_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."jsa_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_permit_references" ADD CONSTRAINT "jsa_permit_references_version_id_jsa_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."jsa_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_permit_references" ADD CONSTRAINT "jsa_permit_references_permit_type_id_permit_types_id_fk" FOREIGN KEY ("permit_type_id") REFERENCES "public"."permit_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_permit_references" ADD CONSTRAINT "jsa_permit_references_attachment_id_jsa_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."jsa_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_permit_verifications" ADD CONSTRAINT "jsa_permit_verifications_permit_ref_id_jsa_permit_references_id_fk" FOREIGN KEY ("permit_ref_id") REFERENCES "public"."jsa_permit_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_permit_verifications" ADD CONSTRAINT "jsa_permit_verifications_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_risk_assessments" ADD CONSTRAINT "jsa_risk_assessments_hazard_id_jsa_step_hazards_id_fk" FOREIGN KEY ("hazard_id") REFERENCES "public"."jsa_step_hazards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_status_history" ADD CONSTRAINT "jsa_status_history_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_status_history" ADD CONSTRAINT "jsa_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_step_hazards" ADD CONSTRAINT "jsa_step_hazards_step_id_jsa_job_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."jsa_job_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_step_hazards" ADD CONSTRAINT "jsa_step_hazards_hazard_master_id_hazard_master_id_fk" FOREIGN KEY ("hazard_master_id") REFERENCES "public"."hazard_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_validity_settings" ADD CONSTRAINT "jsa_validity_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_contractor_company_id_contractor_companies_id_fk" FOREIGN KEY ("contractor_company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_site_id_factory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."factory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_area_id_factory_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."factory_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_job_type_id_job_types_id_fk" FOREIGN KEY ("job_type_id") REFERENCES "public"."job_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_risk_matrix_version_id_risk_matrix_versions_id_fk" FOREIGN KEY ("risk_matrix_version_id") REFERENCES "public"."risk_matrix_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsa_versions" ADD CONSTRAINT "jsa_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_area_id_factory_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."factory_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_contractor_company_id_contractor_companies_id_fk" FOREIGN KEY ("contractor_company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_job_type_id_job_types_id_fk" FOREIGN KEY ("job_type_id") REFERENCES "public"."job_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_jsa_id_jsas_id_fk" FOREIGN KEY ("jsa_id") REFERENCES "public"."jsas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_export_logs" ADD CONSTRAINT "report_export_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_acceptance_rules" ADD CONSTRAINT "risk_acceptance_rules_matrix_version_id_risk_matrix_versions_id_fk" FOREIGN KEY ("matrix_version_id") REFERENCES "public"."risk_matrix_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_matrix_levels" ADD CONSTRAINT "risk_matrix_levels_matrix_version_id_risk_matrix_versions_id_fk" FOREIGN KEY ("matrix_version_id") REFERENCES "public"."risk_matrix_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_matrix_versions" ADD CONSTRAINT "risk_matrix_versions_validated_by_id_users_id_fk" FOREIGN KEY ("validated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_officer_assignments" ADD CONSTRAINT "safety_officer_assignments_site_id_factory_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."factory_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_officer_assignments" ADD CONSTRAINT "safety_officer_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contractor_company_id_contractor_companies_id_fk" FOREIGN KEY ("contractor_company_id") REFERENCES "public"."contractor_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_history_jsa_idx" ON "approval_history" USING btree ("jsa_id");--> statement-breakpoint
CREATE INDEX "approval_instances_jsa_idx" ON "approval_instances" USING btree ("jsa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_instances_one_active_uq" ON "approval_instances" USING btree ("jsa_id") WHERE status = 'IN_PROGRESS';--> statement-breakpoint
CREATE INDEX "approval_tasks_status_stage_idx" ON "approval_tasks" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "approval_tasks_assignee_idx" ON "approval_tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tasks_one_pending_uq" ON "approval_tasks" USING btree ("instance_id") WHERE status = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "approval_wf_step_uq" ON "approval_workflow_steps" USING btree ("workflow_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "area_owner_area_user_uq" ON "area_owner_assignments" USING btree ("area_id","user_id");--> statement-breakpoint
CREATE INDEX "area_owner_user_idx" ON "area_owner_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_occurred_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "jsa_attachments_jsa_idx" ON "jsa_attachments" USING btree ("jsa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jsa_steps_version_no_uq" ON "jsa_job_steps" USING btree ("version_id","step_no");--> statement-breakpoint
CREATE UNIQUE INDEX "jsa_permit_version_type_uq" ON "jsa_permit_references" USING btree ("version_id","permit_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jsa_risk_hazard_phase_uq" ON "jsa_risk_assessments" USING btree ("hazard_id","phase");--> statement-breakpoint
CREATE INDEX "jsa_status_history_jsa_idx" ON "jsa_status_history" USING btree ("jsa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jsa_hazards_step_seq_uq" ON "jsa_step_hazards" USING btree ("step_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "jsa_versions_jsa_version_uq" ON "jsa_versions" USING btree ("jsa_id","version_no");--> statement-breakpoint
CREATE INDEX "jsas_status_idx" ON "jsas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jsas_requester_idx" ON "jsas" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "jsas_area_idx" ON "jsas" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "jsas_planned_start_idx" ON "jsas" USING btree ("planned_start");--> statement-breakpoint
CREATE INDEX "jsas_planned_end_idx" ON "jsas" USING btree ("planned_end");--> statement-breakpoint
CREATE INDEX "jsas_valid_until_idx" ON "jsas" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "jsas_contractor_idx" ON "jsas" USING btree ("contractor_company_id");--> statement-breakpoint
CREATE INDEX "jsas_department_idx" ON "jsas" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "jsas_created_idx" ON "jsas" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_uq" ON "notification_templates" USING btree ("type","channel","language");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_level_matrix_code_uq" ON "risk_matrix_levels" USING btree ("matrix_version_id","code");--> statement-breakpoint
CREATE INDEX "safety_officer_user_idx" ON "safety_officer_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_tokens_user_type_idx" ON "user_tokens" USING btree ("user_id","type");