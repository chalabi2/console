CREATE TABLE IF NOT EXISTS "leaseResize" (
  "id" uuid PRIMARY KEY NOT NULL,
  "deploymentId" uuid NOT NULL,
  "owner" varchar(255) NOT NULL,
  "dseq" varchar(255) NOT NULL,
  "gseq" integer NOT NULL,
  "oseq" integer NOT NULL,
  "bseq" integer NOT NULL,
  "provider" varchar(255) NOT NULL,
  "resources" jsonb NOT NULL,
  "requestedHeight" integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "lease_resize_deployment_id" ON "leaseResize" USING btree ("deploymentId");

DO $$ BEGIN
  ALTER TABLE "leaseResize" ADD CONSTRAINT "leaseResize_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployment" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
