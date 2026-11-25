-- Integrity rules enforced in the database (defence in depth on top of service-layer checks).

-- 1. Circular references between jsas and jsa_versions
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_current_version_fk" FOREIGN KEY ("current_version_id") REFERENCES "jsa_versions"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_approved_version_fk" FOREIGN KEY ("approved_version_id") REFERENCES "jsa_versions"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "jsas" ADD CONSTRAINT "jsas_planned_period_chk" CHECK ("planned_start" IS NULL OR "planned_end" IS NULL OR "planned_end" > "planned_start");
--> statement-breakpoint
ALTER TABLE "jsa_risk_assessments" ADD CONSTRAINT "jsa_risk_range_chk" CHECK ("severity" BETWEEN 1 AND 10 AND "likelihood" BETWEEN 1 AND 10);
--> statement-breakpoint

-- 2. Generic "append-only" guard
CREATE OR REPLACE FUNCTION jsa_forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% not permitted)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approval_history_immutable BEFORE UPDATE OR DELETE ON "approval_history" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER jsa_status_history_immutable BEFORE UPDATE OR DELETE ON "jsa_status_history" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER jsa_declarations_immutable BEFORE UPDATE OR DELETE ON "jsa_declarations" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER jsa_permit_verifications_immutable BEFORE UPDATE OR DELETE ON "jsa_permit_verifications" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint
-- JSA headers are never hard-deleted (soft delete via deleted_at only)
CREATE TRIGGER jsas_no_delete BEFORE DELETE ON "jsas" FOR EACH ROW EXECUTE FUNCTION jsa_forbid_modification();
--> statement-breakpoint

-- 3. Locked (submitted/approved) versions are immutable, including all child rows
CREATE OR REPLACE FUNCTION jsa_guard_locked_version() RETURNS trigger AS $$
BEGIN
  IF OLD.locked THEN
    RAISE EXCEPTION 'JSA version % (v%) is locked and cannot be modified', OLD.id, OLD.version_no USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jsa_versions_locked_guard BEFORE UPDATE OR DELETE ON "jsa_versions" FOR EACH ROW EXECUTE FUNCTION jsa_guard_locked_version();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION jsa_version_is_locked(p_version_id uuid) RETURNS boolean AS $$
  SELECT COALESCE((SELECT locked FROM jsa_versions WHERE id = p_version_id), false);
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION jsa_guard_version_child() RETURNS trigger AS $$
DECLARE v_version uuid;
BEGIN
  IF TG_TABLE_NAME IN ('jsa_job_steps', 'jsa_permit_references') THEN
    v_version := CASE WHEN TG_OP = 'INSERT' THEN NEW.version_id ELSE OLD.version_id END;
  ELSIF TG_TABLE_NAME = 'jsa_step_hazards' THEN
    SELECT s.version_id INTO v_version FROM jsa_job_steps s
      WHERE s.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.step_id ELSE OLD.step_id END;
  ELSE -- jsa_control_measures, jsa_risk_assessments
    SELECT s.version_id INTO v_version FROM jsa_step_hazards h JOIN jsa_job_steps s ON s.id = h.step_id
      WHERE h.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.hazard_id ELSE OLD.hazard_id END;
  END IF;
  IF v_version IS NOT NULL AND jsa_version_is_locked(v_version) THEN
    RAISE EXCEPTION 'Rows of locked JSA version % cannot be modified (%)', v_version, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jsa_job_steps_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON "jsa_job_steps" FOR EACH ROW EXECUTE FUNCTION jsa_guard_version_child();
--> statement-breakpoint
CREATE TRIGGER jsa_permit_refs_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON "jsa_permit_references" FOR EACH ROW EXECUTE FUNCTION jsa_guard_version_child();
--> statement-breakpoint
CREATE TRIGGER jsa_step_hazards_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON "jsa_step_hazards" FOR EACH ROW EXECUTE FUNCTION jsa_guard_version_child();
--> statement-breakpoint
CREATE TRIGGER jsa_controls_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON "jsa_control_measures" FOR EACH ROW EXECUTE FUNCTION jsa_guard_version_child();
--> statement-breakpoint
CREATE TRIGGER jsa_risk_locked_guard BEFORE INSERT OR UPDATE OR DELETE ON "jsa_risk_assessments" FOR EACH ROW EXECUTE FUNCTION jsa_guard_version_child();
--> statement-breakpoint

-- 4. Attachment rows: metadata immutable except soft-removal marker
CREATE OR REPLACE FUNCTION jsa_guard_attachment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.storage_key <> OLD.storage_key OR NEW.sha256 <> OLD.sha256 OR NEW.jsa_id <> OLD.jsa_id
      OR NEW.added_in_version <> OLD.added_in_version OR NEW.size_bytes <> OLD.size_bytes) THEN
    RAISE EXCEPTION 'Attachment metadata is immutable' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM jsa_versions v WHERE v.jsa_id = OLD.jsa_id AND v.locked AND v.version_no >= OLD.added_in_version) THEN
    RAISE EXCEPTION 'Attachment belongs to a submitted version and cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jsa_attachments_guard BEFORE UPDATE OR DELETE ON "jsa_attachments" FOR EACH ROW EXECUTE FUNCTION jsa_guard_attachment();
