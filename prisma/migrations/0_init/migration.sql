-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "proposed_amount" DECIMAL(12,2) NOT NULL,
    "proposed_time" TIMESTAMPTZ(6),
    "time_adjustment" TIMESTAMPTZ(6),
    "approved_time" TIMESTAMPTZ(6),
    "approved_amount" DECIMAL(12,2),
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "negotiation_history" JSONB NOT NULL DEFAULT '[]',
    "ping_count" INTEGER NOT NULL DEFAULT 0,
    "auto_ping_sent" BOOLEAN NOT NULL DEFAULT false,
    "first_ping_at" TIMESTAMPTZ(6),
    "last_ping_at" TIMESTAMPTZ(6),
    "ping_log" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."endorsements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endorser_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "poster_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "budget" DECIMAL(12,2) NOT NULL,
    "budget_min" DECIMAL(12,2),
    "budget_max" DECIMAL(12,2),
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "accepted_application_id" UUID,
    "transaction_id" UUID,
    "payment_method" TEXT NOT NULL DEFAULT 'cash',
    "scheduled_date" TIMESTAMPTZ(6),
    "proposed_time" TIMESTAMPTZ(6),
    "time_is_negotiable" BOOLEAN NOT NULL DEFAULT true,
    "application_deadline" TIMESTAMPTZ(6),
    "publish_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "estimated_duration" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "work_proof_photos" JSONB NOT NULL DEFAULT '[]',
    "completion_request" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "poster_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "provider_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "poster_review" JSONB,
    "provider_review" JSONB,
    "handshake_log" JSONB NOT NULL DEFAULT '[]',
    "qr_handshakes" JSONB NOT NULL DEFAULT '[]',
    "qr_confirmed_by" UUID[] DEFAULT ARRAY[]::UUID[],
    "payment_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "payment_confirmed_at" TIMESTAMPTZ(6),
    "payment_confirmed_by" UUID[] DEFAULT ARRAY[]::UUID[],
    "partial_escrow_released" BOOLEAN NOT NULL DEFAULT false,
    "partial_escrow_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "partial_escrow_released_at" TIMESTAMPTZ(6),
    "payment_wait_time_minutes" DECIMAL,
    "issue_reports" JSONB NOT NULL DEFAULT '[]',
    "stopped_at" TIMESTAMPTZ(6),
    "stopped_by" UUID,
    "helper_completed_at" TIMESTAMPTZ(6),
    "poster_confirmed_at" TIMESTAMPTZ(6),
    "helper_completion_duration_minutes" DECIMAL,
    "poster_confirmation_duration_minutes" DECIMAL,
    "manual_start_allowed_by_poster" BOOLEAN NOT NULL DEFAULT false,
    "manual_start_permission_at" TIMESTAMPTZ(6),
    "manual_start_permission_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "receiver_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "offer_amount" DECIMAL(12,2),
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "job_id" UUID,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID,
    "job_id" UUID,
    "reviewer_id" UUID NOT NULL,
    "reviewee_id" UUID NOT NULL,
    "service_id" UUID,
    "categories" JSONB NOT NULL DEFAULT '{}',
    "overall_rating" INTEGER NOT NULL,
    "comment" TEXT,
    "is_constructive" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "moderated_at" TIMESTAMPTZ(6),
    "moderation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rand_amount" DECIMAL(12,2) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "map_pin_locked" BOOLEAN NOT NULL DEFAULT true,
    "map_visibility" TEXT NOT NULL DEFAULT 'public',
    "pricing_type" TEXT NOT NULL DEFAULT 'fixed',
    "scheduled_date" TIMESTAMPTZ(6),
    "estimated_duration" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "images" JSONB NOT NULL DEFAULT '[]',
    "profile_view_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "completed_jobs_count" INTEGER NOT NULL DEFAULT 0,
    "average_rating" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "rating_breakdown" JSONB NOT NULL DEFAULT '{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sms_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "user_id" UUID,
    "invite_email" TEXT NOT NULL DEFAULT '',
    "invite_phone" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(6),
    "qr_confirmed_at" TIMESTAMPTZ(6),
    "confirmed_role" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supervisor_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'team',
    "description" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "map_visible" BOOLEAN NOT NULL DEFAULT true,
    "qr_code" TEXT NOT NULL DEFAULT '',
    "qr_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requester_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "service_id" UUID,
    "job_id" UUID,
    "rand_amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "escrow_status" TEXT NOT NULL DEFAULT 'held',
    "job_description_images" JSONB NOT NULL DEFAULT '[]',
    "proof_images" JSONB NOT NULL DEFAULT '[]',
    "requester_rating" INTEGER,
    "provider_rating" INTEGER,
    "requester_review" TEXT,
    "provider_review" TEXT,
    "negotiated_amount" DECIMAL(12,2),
    "payment_method" TEXT NOT NULL DEFAULT 'cash',
    "negotiation_history" JSONB NOT NULL DEFAULT '[]',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "completed_at" TIMESTAMPTZ(6),
    "partial_release_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "partial_released_at" TIMESTAMPTZ(6),
    "partial_released_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."trust_docs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "file_url" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'client',
    "lat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lng" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avatar" TEXT NOT NULL DEFAULT '',
    "credits" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "rand_balance" DECIMAL(12,2) NOT NULL DEFAULT 1000,
    "escrow_rand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_earned_rand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bank_account" JSONB NOT NULL DEFAULT '{}',
    "rating" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "profile_image" TEXT NOT NULL DEFAULT '',
    "is_online" BOOLEAN NOT NULL DEFAULT true,
    "last_active" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "show_online_status" BOOLEAN NOT NULL DEFAULT true,
    "primary_category" TEXT NOT NULL DEFAULT '',
    "free_service_used" BOOLEAN NOT NULL DEFAULT false,
    "paid_profile_views" JSONB NOT NULL DEFAULT '[]',
    "portfolio_images" JSONB NOT NULL DEFAULT '[]',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "community_stats" JSONB NOT NULL DEFAULT '{"disputeRate": 0, "jobsCompleted": 0, "jobsRequested": 0, "completionRate": 100, "impatientFlags": 0, "complainerScore": 0, "givenRatingsAvg": 0, "timeWasterFlags": 0, "cancellationRate": 0, "reliabilityScore": 100, "providerLateFlags": 0, "totalGivenReviews": 0, "receivedRatingsAvg": 0, "totalReceivedReviews": 0}',
    "flags" JSONB NOT NULL DEFAULT '[]',
    "saved_services" JSONB NOT NULL DEFAULT '[]',
    "recommendations_sent" JSONB NOT NULL DEFAULT '[]',
    "referral_code" TEXT,
    "referred_by" UUID,
    "referral_count" INTEGER NOT NULL DEFAULT 0,
    "email_verification_token" TEXT,
    "email_verification_expires" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lock_until" TIMESTAMPTZ(6),
    "professional_service_tc_accepted" BOOLEAN NOT NULL DEFAULT false,
    "professional_service_tc_accepted_at" TIMESTAMPTZ(6),
    "account_type" TEXT NOT NULL DEFAULT 'individual',
    "business_name" TEXT NOT NULL DEFAULT '',
    "team_size" INTEGER NOT NULL DEFAULT 1,
    "team_id" UUID,
    "team_role" TEXT,
    "trust_stars" DECIMAL(3,1) NOT NULL DEFAULT 0.5,
    "trust_score" INTEGER NOT NULL DEFAULT 10,
    "trust_level" TEXT NOT NULL DEFAULT 'New Neighbour',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bio" TEXT NOT NULL DEFAULT '',
    "terms_accepted_at" TIMESTAMPTZ(6),
    "terms_version" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "id_front" TEXT NOT NULL,
    "id_back" TEXT NOT NULL,
    "selfie" TEXT NOT NULL,
    "id_number" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_experience" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT '',
    "years" TEXT NOT NULL DEFAULT '',
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_experience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applications_applicant_idx" ON "public"."applications"("applicant_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_job_id_applicant_id_key" ON "public"."applications"("job_id" ASC, "applicant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "endorsements_user_id_endorser_id_key" ON "public"."endorsements"("user_id" ASC, "endorser_id" ASC);

-- CreateIndex
CREATE INDEX "jobs_browse_idx" ON "public"."jobs"("status" ASC, "category" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_poster_idx" ON "public"."jobs"("poster_id" ASC, "status" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_transaction_idx" ON "public"."jobs"("transaction_id" ASC);

-- CreateIndex
CREATE INDEX "messages_transaction_idx" ON "public"."messages"("transaction_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_job_idx" ON "public"."notifications"("job_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_idx" ON "public"."notifications"("user_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_reviewee_idx" ON "public"."reviews"("reviewee_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_reviewer_idx" ON "public"."reviews"("reviewer_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_service_idx" ON "public"."reviews"("service_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_transaction_idx" ON "public"."reviews"("transaction_id" ASC);

-- CreateIndex
CREATE INDEX "services_category_idx" ON "public"."services"("category" ASC, "available" ASC);

-- CreateIndex
CREATE INDEX "services_provider_idx" ON "public"."services"("provider_id" ASC, "available" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "sms_verifications_user_idx" ON "public"."sms_verifications"("user_id" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "team_members_team_idx" ON "public"."team_members"("team_id" ASC);

-- CreateIndex
CREATE INDEX "team_members_user_idx" ON "public"."team_members"("user_id" ASC);

-- CreateIndex
CREATE INDEX "teams_supervisor_idx" ON "public"."teams"("supervisor_id" ASC);

-- CreateIndex
CREATE INDEX "transactions_job_idx" ON "public"."transactions"("job_id" ASC);

-- CreateIndex
CREATE INDEX "transactions_provider_idx" ON "public"."transactions"("provider_id" ASC, "status" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_requester_idx" ON "public"."transactions"("requester_id" ASC, "status" ASC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "trust_docs_user_idx" ON "public"."trust_docs"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_online_idx" ON "public"."users"("is_online" ASC, "last_active" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "public"."users"("referral_code" ASC);

-- CreateIndex
CREATE INDEX "users_role_category_idx" ON "public"."users"("role" ASC, "primary_category" ASC);

-- CreateIndex
CREATE INDEX "verifications_user_idx" ON "public"."verifications"("user_id" ASC);

-- CreateIndex
CREATE INDEX "work_experience_user_idx" ON "public"."work_experience"("user_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."endorsements" ADD CONSTRAINT "endorsements_endorser_id_fkey" FOREIGN KEY ("endorser_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."endorsements" ADD CONSTRAINT "endorsements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_poster_id_fkey" FOREIGN KEY ("poster_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."jobs" ADD CONSTRAINT "jobs_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."services" ADD CONSTRAINT "services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sms_verifications" ADD CONSTRAINT "sms_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."teams" ADD CONSTRAINT "teams_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_job_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."transactions" ADD CONSTRAINT "transactions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."trust_docs" ADD CONSTRAINT "trust_docs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_team_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."verifications" ADD CONSTRAINT "verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."work_experience" ADD CONSTRAINT "work_experience_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

