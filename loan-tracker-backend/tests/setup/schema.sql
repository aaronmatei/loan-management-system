--
-- PostgreSQL database dump
--

\restrict 1abQRES8fLd9wgdDFWf3SkmnTgF6om34mRVLNtaA6FyHgbRiBIP5KxYHU4AccMx

-- Dumped from database version 18.3 (Ubuntu 18.3-1)
-- Dumped by pg_dump version 18.3 (Ubuntu 18.3-1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_id integer,
    table_name character varying(50),
    action character varying(50),
    record_id integer,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_email character varying(255),
    user_name character varying(255),
    entity_type character varying(50),
    entity_id integer,
    entity_code character varying(100),
    description text,
    ip_address character varying(45),
    user_agent text,
    metadata jsonb,
    tenant_id integer,
    action_category character varying(50),
    entity_label character varying(255),
    severity character varying(20) DEFAULT 'info'::character varying,
    status character varying(20) DEFAULT 'success'::character varying,
    user_role character varying(50),
    is_platform_admin boolean DEFAULT false
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backups (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_size bigint,
    backup_type character varying(20) DEFAULT 'manual'::character varying,
    status character varying(20) DEFAULT 'success'::character varying,
    error_message text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: backups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backups_id_seq OWNED BY public.backups.id;


--
-- Name: billing_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_activities (
    id integer NOT NULL,
    tenant_id integer,
    invoice_id integer,
    activity_type character varying(50) NOT NULL,
    details jsonb,
    performed_by_user_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: billing_activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_activities_id_seq OWNED BY public.billing_activities.id;


--
-- Name: capital_pool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capital_pool (
    id integer NOT NULL,
    initial_capital numeric(15,2) NOT NULL,
    total_disbursed numeric(15,2) DEFAULT 0,
    total_collected numeric(15,2) DEFAULT 0,
    total_interest_earned numeric(15,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    tenant_id integer NOT NULL
);


--
-- Name: capital_pool_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capital_pool_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capital_pool_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capital_pool_id_seq OWNED BY public.capital_pool.id;


--
-- Name: capital_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capital_transactions (
    id integer NOT NULL,
    transaction_type character varying(20) NOT NULL,
    amount numeric(15,2) NOT NULL,
    loan_id integer,
    transaction_id integer,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: capital_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capital_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capital_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capital_transactions_id_seq OWNED BY public.capital_transactions.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    client_code character varying(20),
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    phone_number character varying(15) NOT NULL,
    email character varying(100),
    id_number character varying(20),
    business_name character varying(100),
    business_type character varying(50),
    address text,
    city character varying(50),
    county character varying(50),
    status character varying(20) DEFAULT 'active'::character varying,
    kyc_verified boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id integer NOT NULL,
    gender character varying(10),
    date_of_birth date,
    signup_promo_code character varying(40),
    branch_id integer,
    client_type character varying(20) NOT NULL DEFAULT 'individual'
        CHECK (client_type IN ('individual', 'group', 'business')),
    credit_score integer,
    registration_no character varying(50),
    meeting_frequency character varying(20),
    member_count integer
);

CREATE TABLE public.loan_packages (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL,
    name character varying(80) NOT NULL,
    description text,
    annual_interest_rate numeric(6,2) NOT NULL CHECK (annual_interest_rate >= 0),
    processing_fee_rate numeric(5,2) NOT NULL DEFAULT 0
        CHECK (processing_fee_rate >= 0 AND processing_fee_rate <= 100),
    interest_method character varying(20) NOT NULL DEFAULT 'flat'
        CHECK (interest_method IN ('flat', 'reducing')),
    min_amount numeric(15,2) NOT NULL CHECK (min_amount > 0),
    max_amount numeric(15,2) NOT NULL CHECK (max_amount >= min_amount),
    min_duration_months integer NOT NULL CHECK (min_duration_months > 0),
    max_duration_months integer NOT NULL
        CHECK (max_duration_months >= min_duration_months),
    active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now(),
    min_credit_score integer
        CHECK (min_credit_score IS NULL OR min_credit_score >= 0),
    allowed_client_types text[] NOT NULL DEFAULT '{}',
    allowed_branch_ids integer[] NOT NULL DEFAULT '{}',
    allowed_purposes text[] NOT NULL DEFAULT '{}',
    loan_type character varying(20) NOT NULL DEFAULT 'personal'  -- migration 047
);
CREATE UNIQUE INDEX loan_packages_tenant_name_active_unique
    ON public.loan_packages (tenant_id, lower((name)::text)) WHERE active;
CREATE INDEX idx_loan_packages_tenant ON public.loan_packages (tenant_id);

CREATE TABLE public.branches (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL,
    name character varying(80) NOT NULL,
    code character varying(20),
    location character varying(120),
    phone character varying(20),
    is_default boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT now(),
    updated_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX branches_tenant_name_active_unique
    ON public.branches (tenant_id, lower((name)::text)) WHERE active;
CREATE UNIQUE INDEX branches_tenant_default_unique
    ON public.branches (tenant_id) WHERE is_default;
CREATE INDEX idx_branches_tenant ON public.branches (tenant_id);

CREATE TABLE public.promo_codes (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL,
    code character varying(40) NOT NULL UNIQUE,
    label character varying(120),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_id_seq OWNED BY public.clients.id;


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    id integer NOT NULL,
    company_name character varying(255) DEFAULT 'Your Company'::character varying NOT NULL,
    company_address text,
    company_phone character varying(20),
    company_email character varying(100),
    company_website character varying(100),
    company_logo_url text,
    business_registration_number character varying(50),
    tax_pin character varying(20),
    agreement_terms text,
    bank_name character varying(100),
    bank_account_number character varying(50),
    bank_branch character varying(100),
    mpesa_paybill character varying(20),
    mpesa_till_number character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: company_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_settings_id_seq OWNED BY public.company_settings.id;


--
-- Name: customer_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_activities (
    id integer NOT NULL,
    platform_customer_id integer,
    tenant_id integer,
    client_id integer,
    activity_type character varying(50) NOT NULL,
    details jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: customer_activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_activities_id_seq OWNED BY public.customer_activities.id;


--
-- Name: customer_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_invitations (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    client_id integer NOT NULL,
    invitation_code character varying(50) NOT NULL,
    phone_number character varying(20),
    email character varying(255),
    sent_via character varying(20),
    status character varying(20) DEFAULT 'pending'::character varying,
    invited_by integer,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: customer_invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_invitations_id_seq OWNED BY public.customer_invitations.id;


--
-- Name: customer_tenant_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tenant_links (
    id integer NOT NULL,
    platform_customer_id integer NOT NULL,
    tenant_id integer NOT NULL,
    client_id integer,
    member_id integer,
    status character varying(20) DEFAULT 'active'::character varying,
    linked_at timestamp without time zone DEFAULT now(),
    last_activity_at timestamp without time zone,
    CONSTRAINT ctl_client_or_member CHECK (client_id IS NOT NULL OR member_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ctl_member ON public.customer_tenant_links(member_id) WHERE member_id IS NOT NULL;


--
-- Name: customer_tenant_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_tenant_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_tenant_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_tenant_links_id_seq OWNED BY public.customer_tenant_links.id;


--
-- Name: dashboard_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_metrics (
    id integer NOT NULL,
    metric_date date,
    total_active_loans integer,
    total_loans_amount numeric(14,2),
    total_amount_paid numeric(14,2),
    outstanding_balance numeric(14,2),
    total_overdue_accounts integer,
    collection_rate numeric(5,2),
    default_rate numeric(5,2),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dashboard_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboard_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboard_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboard_metrics_id_seq OWNED BY public.dashboard_metrics.id;


--
-- Name: demo_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_sessions (
    id integer NOT NULL,
    session_token character varying(100) NOT NULL,
    ip_address character varying(45),
    user_agent text,
    actions_count integer DEFAULT 0,
    converted_to_signup boolean DEFAULT false,
    started_at timestamp without time zone DEFAULT now(),
    last_active_at timestamp without time zone DEFAULT now()
);


--
-- Name: demo_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demo_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demo_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demo_sessions_id_seq OWNED BY public.demo_sessions.id;


--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id integer NOT NULL,
    client_id integer,
    loan_id integer,
    recipient_email character varying(255) NOT NULL,
    subject character varying(500) NOT NULL,
    message_type character varying(50),
    has_attachment boolean DEFAULT false,
    attachment_name character varying(255),
    status character varying(20) DEFAULT 'sent'::character varying,
    provider_response jsonb,
    sent_by integer,
    created_at timestamp without time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: email_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_logs_id_seq OWNED BY public.email_logs.id;


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    payment_method character varying(30) NOT NULL,
    payment_reference character varying(100),
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    recorded_by_user_id integer,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: invoice_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_payments_id_seq OWNED BY public.invoice_payments.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    billing_month integer NOT NULL,
    billing_year integer NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    interest_earned numeric(15,2) DEFAULT 0 NOT NULL,
    fee_percentage numeric(5,2) DEFAULT 5.00 NOT NULL,
    amount_due numeric(15,2) NOT NULL,
    base_fee numeric(15,2) DEFAULT 0,
    addon_fees numeric(15,2) DEFAULT 0,
    discount numeric(15,2) DEFAULT 0,
    total_amount numeric(15,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    amount_paid numeric(15,2) DEFAULT 0,
    paid_at timestamp without time zone,
    payment_method character varying(30),
    payment_reference character varying(100),
    paid_by_user_id integer,
    issued_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    notes text,
    internal_notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loans (
    id integer NOT NULL,
    loan_code character varying(30),
    client_id integer NOT NULL,
    principal_amount numeric(12,2) NOT NULL,
    interest_rate numeric(5,2) NOT NULL,
    loan_duration_months integer NOT NULL,
    start_date date,
    end_date date,
    disbursement_date date,
    total_amount_due numeric(12,2),
    total_interest numeric(12,2),
    status character varying(30) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    overpayment_amount numeric(12,2) DEFAULT 0,
    refund_status character varying(20) DEFAULT NULL::character varying,
    refunded_date date,
    refund_method character varying(30) DEFAULT NULL::character varying,
    refund_reference character varying(100) DEFAULT NULL::character varying,
    notes text,
    purpose text,
    agreement_signed boolean DEFAULT false,
    agreement_signed_date date,
    agreement_witnessed_by character varying(255),
    guarantor_name character varying(255),
    guarantor_phone character varying(20),
    guarantor_id_number character varying(20),
    collateral_description text,
    late_payment_fee numeric(10,2) DEFAULT 500,
    penalty_rate numeric(5,2) DEFAULT 5.00,
    processing_fee_rate numeric(5,2) DEFAULT 0,
    processing_fee numeric(12,2) DEFAULT 0,
    net_disbursed_amount numeric(12,2),
    application_date date,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    approved_by integer,
    approved_at timestamp without time zone,
    disbursed_by integer,
    disbursed_at timestamp without time zone,
    disbursement_method character varying(30),
    disbursement_reference character varying(100),
    rejection_reason text,
    rejected_by integer,
    rejected_at timestamp without time zone,
    review_notes text,
    application_source character varying(50) DEFAULT 'walk_in'::character varying,
    tenant_id integer NOT NULL,
    submitted_by_customer boolean DEFAULT false,
    platform_customer_id integer,
    requested_amount numeric(12,2),
    offered_amount numeric(12,2),
    counter_offered_by integer,
    counter_offered_at timestamp without time zone,
    counter_offer_note text,
    package_id integer,
    interest_method character varying(20) NOT NULL DEFAULT 'flat'
        CHECK (interest_method IN ('flat', 'reducing')),
    loan_type character varying(20) NOT NULL DEFAULT 'personal',  -- migration 047
    group_id integer,  -- migration 051 (group / chama member loans)
    cycle_id integer,  -- migration 054 (group lending cycle/round)
    branch_id integer,  -- migration 068 (multi-branch)
    grace_days integer,  -- migration 070 (per-pledge override)
    auction_notice_days integer  -- migration 070 (per-pledge override)
);
CREATE INDEX idx_loans_branch ON public.loans(branch_id);


--
-- Name: loans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loans_id_seq OWNED BY public.loans.id;


--
-- Name: mpesa_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mpesa_transactions (
    id integer NOT NULL,
    tenant_id integer,
    purpose character varying(30) NOT NULL,
    loan_id integer,
    invoice_id integer,
    customer_id integer,
    initiated_by_user_id integer,
    phone_number character varying(20) NOT NULL,
    amount numeric(15,2) NOT NULL,
    account_reference character varying(64),
    transaction_desc character varying(128),
    merchant_request_id character varying(64),
    checkout_request_id character varying(64),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    result_code integer,
    result_desc text,
    mpesa_receipt_number character varying(32),
    transaction_date timestamp without time zone,
    paid_phone_number character varying(20),
    request_payload jsonb,
    callback_payload jsonb,
    welfare_id integer,
    member_id integer,
    target_type character varying(30),
    target_id integer,
    allocated boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: mpesa_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mpesa_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mpesa_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mpesa_transactions_id_seq OWNED BY public.mpesa_transactions.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    client_id integer,
    loan_id integer,
    notification_type character varying(30),
    channel character varying(20),
    recipient character varying(100),
    message text,
    status character varying(20) DEFAULT 'pending'::character varying,
    sent_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    user_id integer,
    type character varying(50),
    title character varying(255),
    icon character varying(20),
    link character varying(255),
    metadata jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp without time zone,
    tenant_id integer
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: payment_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_schedules (
    id integer NOT NULL,
    loan_id integer NOT NULL,
    payment_number integer NOT NULL,
    due_date date NOT NULL,
    amount_due numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    amount_paid numeric(12,2) DEFAULT 0,
    actual_payment_date date,
    days_late integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id integer NOT NULL,
    penalty_paid numeric(12,2) DEFAULT 0,
    late_fee_charged numeric(15,2) DEFAULT 0,
    penalty_interest_charged numeric(15,2) DEFAULT 0,
    interest_paid numeric(12,2) DEFAULT 0,
    interest_portion numeric(12,2) NOT NULL DEFAULT 0,
    principal_portion numeric(12,2) NOT NULL DEFAULT 0,
    balance_after numeric(12,2) NOT NULL DEFAULT 0
);


--
-- Name: payment_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_schedules_id_seq OWNED BY public.payment_schedules.id;


--
-- Name: platform_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_customers (
    id integer NOT NULL,
    phone_number character varying(20) NOT NULL,
    email character varying(255),
    id_number character varying(20) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    date_of_birth date,
    gender character varying(10),
    password_hash character varying(255),
    phone_verified boolean DEFAULT false,
    email_verified boolean DEFAULT false,
    otp_code character varying(6),
    otp_expires_at timestamp without time zone,
    otp_attempts integer DEFAULT 0,
    otp_purpose character varying(30),
    profile_photo_url text,
    id_front_url text,
    id_back_url text,
    business_name character varying(100),
    business_type character varying(50),
    city character varying(50),
    county character varying(50),
    address text,
    signup_promo_code character varying(40),
    is_active boolean DEFAULT true,
    is_blacklisted_platform boolean DEFAULT false,
    blacklist_reason text,
    last_login timestamp without time zone,
    registration_tenant_id integer,
    registration_ip character varying(45),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    must_change_password boolean DEFAULT false,
    client_type character varying(20) NOT NULL DEFAULT 'individual'
        CHECK (client_type IN ('individual', 'group', 'business'))
);


--
-- Name: platform_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_customers_id_seq OWNED BY public.platform_customers.id;


--
-- Name: referral_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_config (
    id integer NOT NULL,
    referrer_reward_type character varying(30) DEFAULT 'free_month'::character varying,
    referrer_reward_value numeric(10,2) DEFAULT 1,
    referred_reward_type character varying(30) DEFAULT 'none'::character varying,
    referred_reward_value numeric(10,2) DEFAULT 0,
    qualification character varying(30) DEFAULT 'active'::character varying,
    enabled boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: referral_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referral_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referral_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referral_config_id_seq OWNED BY public.referral_config.id;


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id integer NOT NULL,
    referrer_tenant_id integer NOT NULL,
    referred_tenant_id integer,
    referral_code character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    referrer_reward_type character varying(30),
    referrer_reward_value numeric(10,2),
    referrer_rewarded boolean DEFAULT false,
    referred_reward_type character varying(30),
    referred_reward_value numeric(10,2),
    referred_rewarded boolean DEFAULT false,
    referred_business_name character varying(255),
    signed_up_at timestamp without time zone DEFAULT now(),
    qualified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;


--
-- Name: sms_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_logs (
    id integer NOT NULL,
    client_id integer,
    loan_id integer,
    phone_number character varying(20) NOT NULL,
    message text NOT NULL,
    message_type character varying(50),
    status character varying(20) DEFAULT 'sent'::character varying,
    cost numeric(10,4),
    provider_response jsonb,
    sent_by integer,
    created_at timestamp without time zone DEFAULT now(),
    tenant_id integer
);


--
-- Name: sms_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sms_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sms_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sms_logs_id_seq OWNED BY public.sms_logs.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    setting_key character varying(50) NOT NULL,
    setting_value text,
    description text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    tenant_code character varying(20) NOT NULL,
    business_name character varying(255) NOT NULL,
    business_type character varying(100),
    kind character varying(20) NOT NULL DEFAULT 'lender',  -- migration 058 (lender | welfare)
    subdomain character varying(50) NOT NULL,
    registration_number character varying(100),
    tax_pin character varying(20),
    contact_name character varying(255) NOT NULL,
    contact_email character varying(255) NOT NULL,
    contact_phone character varying(20),
    physical_address text,
    city character varying(100),
    county character varying(100),
    country character varying(50) DEFAULT 'Kenya'::character varying,
    plan character varying(50) DEFAULT 'trial'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    trial_ends_at timestamp without time zone,
    subscription_starts_at timestamp without time zone,
    platform_fee_percentage numeric(5,2) DEFAULT 5.00,
    monthly_base_fee numeric(10,2) DEFAULT 0,
    max_clients integer DEFAULT 100,
    max_loans integer DEFAULT 100,
    max_users integer DEFAULT 3,
    payment_paybill character varying(20),
    payment_reference character varying(50),
    total_interest_earned numeric(15,2) DEFAULT 0,
    total_platform_fees_paid numeric(15,2) DEFAULT 0,
    total_platform_fees_owed numeric(15,2) DEFAULT 0,
    last_billing_date date,
    logo_url text,
    brand_color character varying(7) DEFAULT '#0E8A6E'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    customer_portal_enabled boolean DEFAULT true,
    allow_self_signup boolean DEFAULT true,
    lends_to_non_members boolean DEFAULT false NOT NULL,
    allow_online_applications boolean DEFAULT true,
    otp_count_this_month integer DEFAULT 0,
    otp_quota_per_month integer DEFAULT 100,
    suspension_reason text,
    billing_enabled boolean DEFAULT true,
    billing_fee_percentage numeric(5,2) DEFAULT 5.00,
    billing_base_fee numeric(15,2) DEFAULT 0,
    billing_day_of_month integer DEFAULT 1,
    billing_grace_period_days integer DEFAULT 14,
    billing_suspend_after_days integer DEFAULT 30,
    last_invoice_date date,
    billing_contact_email character varying(255),
    billing_contact_phone character varying(20),
    onboarding_completed boolean DEFAULT false,
    onboarding_step integer DEFAULT 1,
    onboarding_data jsonb DEFAULT '{}'::jsonb,
    onboarding_completed_at timestamp without time zone,
    onboarding_skipped boolean DEFAULT false,
    business_hours character varying(100),
    business_description text,
    white_label_tier character varying(20) DEFAULT 'basic'::character varying,
    hide_platform_branding boolean DEFAULT false,
    favicon_url text,
    email_sender_name character varying(100),
    sms_sender_id character varying(20),
    email_signature text,
    report_header_text text,
    report_footer_text text,
    support_email character varying(255),
    support_phone character varying(20),
    custom_domain character varying(255),
    custom_email_domain character varying(100),
    terms_url text,
    privacy_url text,
    custom_portal_title character varying(100),
    custom_portal_tagline character varying(200),
    custom_login_image_url text,
    default_interest_rate numeric(5,2) DEFAULT 50.00,
    processing_fee_rate numeric(5,2) DEFAULT 0,
    default_loan_duration integer DEFAULT 6,
    min_loan_amount numeric(15,2) DEFAULT 1000,
    max_loan_amount numeric(15,2) DEFAULT 1000000,
    late_payment_fee numeric(15,2) DEFAULT 500,
    notify_application_submitted_sms boolean DEFAULT true,
    notify_application_submitted_email boolean DEFAULT true,
    notify_under_review_sms boolean DEFAULT true,
    notify_under_review_email boolean DEFAULT true,
    notify_approved_sms boolean DEFAULT true,
    notify_approved_email boolean DEFAULT true,
    notify_rejected_sms boolean DEFAULT true,
    notify_rejected_email boolean DEFAULT true,
    notify_counter_offered_sms boolean DEFAULT true,
    notify_counter_offered_email boolean DEFAULT true,
    notify_disbursed_sms boolean DEFAULT true,
    notify_disbursed_email boolean DEFAULT true,
    notify_payment_sms boolean DEFAULT true,
    notify_payment_email boolean DEFAULT true,
    notify_reminder_sms boolean DEFAULT true,
    notify_reminder_email boolean DEFAULT true,
    notify_overdue_sms boolean DEFAULT true,
    notify_overdue_email boolean DEFAULT true,
    notify_completed_sms boolean DEFAULT true,
    notify_completed_email boolean DEFAULT true,
    reminder_days_before integer DEFAULT 3,
    overdue_reminder_frequency_days integer DEFAULT 3,
    is_demo boolean DEFAULT false,
    referral_code character varying(20),
    referred_by_tenant_id integer,
    referral_credits integer DEFAULT 0,
    trial_days integer DEFAULT 14,
    mpesa_enabled boolean DEFAULT true,
    mpesa_shortcode character varying(20),
    mpesa_passkey character varying(128),
    mpesa_consumer_key character varying(128),
    mpesa_consumer_secret character varying(128),
    mpesa_use_platform_credentials boolean DEFAULT true
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    transaction_code character varying(30),
    loan_id integer NOT NULL,
    client_id integer NOT NULL,
    amount_paid numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    payment_method character varying(30),
    payment_reference character varying(100),
    payment_status character varying(20) DEFAULT 'completed'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    tenant_id integer NOT NULL,
    penalty_portion numeric(12,2) DEFAULT 0,
    overpayment_portion numeric(12,2) DEFAULT 0,
    voided_at timestamp without time zone,
    voided_by integer,
    void_reason text
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    role character varying(20) DEFAULT 'loan_officer'::character varying,
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    phone_number character varying(20),
    created_by integer,
    tenant_id integer NOT NULL,
    is_platform_admin boolean DEFAULT false
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: backups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups ALTER COLUMN id SET DEFAULT nextval('public.backups_id_seq'::regclass);


--
-- Name: billing_activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_activities ALTER COLUMN id SET DEFAULT nextval('public.billing_activities_id_seq'::regclass);


--
-- Name: capital_pool id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_pool ALTER COLUMN id SET DEFAULT nextval('public.capital_pool_id_seq'::regclass);


--
-- Name: capital_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transactions ALTER COLUMN id SET DEFAULT nextval('public.capital_transactions_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public.clients_id_seq'::regclass);


--
-- Name: company_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings ALTER COLUMN id SET DEFAULT nextval('public.company_settings_id_seq'::regclass);


--
-- Name: customer_activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activities ALTER COLUMN id SET DEFAULT nextval('public.customer_activities_id_seq'::regclass);


--
-- Name: customer_invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations ALTER COLUMN id SET DEFAULT nextval('public.customer_invitations_id_seq'::regclass);


--
-- Name: customer_tenant_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links ALTER COLUMN id SET DEFAULT nextval('public.customer_tenant_links_id_seq'::regclass);


--
-- Name: dashboard_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_metrics ALTER COLUMN id SET DEFAULT nextval('public.dashboard_metrics_id_seq'::regclass);


--
-- Name: demo_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions ALTER COLUMN id SET DEFAULT nextval('public.demo_sessions_id_seq'::regclass);


--
-- Name: email_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs ALTER COLUMN id SET DEFAULT nextval('public.email_logs_id_seq'::regclass);


--
-- Name: invoice_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments ALTER COLUMN id SET DEFAULT nextval('public.invoice_payments_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: loans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans ALTER COLUMN id SET DEFAULT nextval('public.loans_id_seq'::regclass);


--
-- Name: mpesa_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions ALTER COLUMN id SET DEFAULT nextval('public.mpesa_transactions_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: payment_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_schedules ALTER COLUMN id SET DEFAULT nextval('public.payment_schedules_id_seq'::regclass);


--
-- Name: platform_customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_customers ALTER COLUMN id SET DEFAULT nextval('public.platform_customers_id_seq'::regclass);


--
-- Name: referral_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_config ALTER COLUMN id SET DEFAULT nextval('public.referral_config_id_seq'::regclass);


--
-- Name: referrals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);


--
-- Name: sms_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs ALTER COLUMN id SET DEFAULT nextval('public.sms_logs_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: backups backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);


--
-- Name: billing_activities billing_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_activities
    ADD CONSTRAINT billing_activities_pkey PRIMARY KEY (id);


--
-- Name: capital_pool capital_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_pool
    ADD CONSTRAINT capital_pool_pkey PRIMARY KEY (id);


--
-- Name: capital_transactions capital_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transactions
    ADD CONSTRAINT capital_transactions_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: clients clients_tenant_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_tenant_code_unique UNIQUE (tenant_id, client_code);


--
-- Name: clients clients_tenant_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_tenant_phone_unique UNIQUE (tenant_id, phone_number);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (id);


--
-- Name: customer_activities customer_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activities
    ADD CONSTRAINT customer_activities_pkey PRIMARY KEY (id);


--
-- Name: customer_invitations customer_invitations_invitation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations
    ADD CONSTRAINT customer_invitations_invitation_code_key UNIQUE (invitation_code);


--
-- Name: customer_invitations customer_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations
    ADD CONSTRAINT customer_invitations_pkey PRIMARY KEY (id);


--
-- Name: customer_tenant_links customer_tenant_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_pkey PRIMARY KEY (id);


--
-- Name: customer_tenant_links customer_tenant_links_platform_customer_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_platform_customer_id_client_id_key UNIQUE (platform_customer_id, client_id);


--
-- Name: customer_tenant_links customer_tenant_links_platform_customer_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_platform_customer_id_tenant_id_key UNIQUE (platform_customer_id, tenant_id);


--
-- Name: dashboard_metrics dashboard_metrics_metric_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_metrics
    ADD CONSTRAINT dashboard_metrics_metric_date_key UNIQUE (metric_date);


--
-- Name: dashboard_metrics dashboard_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_metrics
    ADD CONSTRAINT dashboard_metrics_pkey PRIMARY KEY (id);


--
-- Name: demo_sessions demo_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions
    ADD CONSTRAINT demo_sessions_pkey PRIMARY KEY (id);


--
-- Name: demo_sessions demo_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_sessions
    ADD CONSTRAINT demo_sessions_session_token_key UNIQUE (session_token);


--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_tenant_id_billing_month_billing_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_billing_month_billing_year_key UNIQUE (tenant_id, billing_month, billing_year);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: loans loans_tenant_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_tenant_code_unique UNIQUE (tenant_id, loan_code);


--
-- Name: mpesa_transactions mpesa_transactions_checkout_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_checkout_request_id_key UNIQUE (checkout_request_id);


--
-- Name: mpesa_transactions mpesa_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_schedules payment_schedules_loan_id_payment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_schedules
    ADD CONSTRAINT payment_schedules_loan_id_payment_number_key UNIQUE (loan_id, payment_number);


--
-- Name: payment_schedules payment_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_schedules
    ADD CONSTRAINT payment_schedules_pkey PRIMARY KEY (id);


--
-- Name: platform_customers platform_customers_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_customers
    ADD CONSTRAINT platform_customers_id_number_key UNIQUE (id_number);


--
-- Name: platform_customers platform_customers_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_customers
    ADD CONSTRAINT platform_customers_phone_number_key UNIQUE (phone_number);


--
-- Name: platform_customers platform_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_customers
    ADD CONSTRAINT platform_customers_pkey PRIMARY KEY (id);


--
-- Name: referral_config referral_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_config
    ADD CONSTRAINT referral_config_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: sms_logs sms_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: tenants tenants_contact_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_contact_email_key UNIQUE (contact_email);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_referral_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_referral_code_key UNIQUE (referral_code);


--
-- Name: tenants tenants_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_subdomain_key UNIQUE (subdomain);


--
-- Name: tenants tenants_tenant_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_tenant_code_key UNIQUE (tenant_code);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_tenant_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_tenant_code_unique UNIQUE (tenant_id, transaction_code);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_action ON public.audit_logs USING btree (action);


--
-- Name: idx_audit_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_category ON public.audit_logs USING btree (action_category);


--
-- Name: idx_audit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_date ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_audit_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_severity ON public.audit_logs USING btree (severity);


--
-- Name: idx_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_tenant ON public.audit_logs USING btree (tenant_id);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_backups_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backups_date ON public.backups USING btree (created_at DESC);


--
-- Name: idx_billing_activities_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_activities_date ON public.billing_activities USING btree (created_at DESC);


--
-- Name: idx_billing_activities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_activities_tenant ON public.billing_activities USING btree (tenant_id);


--
-- Name: idx_capital_txn_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capital_txn_created_at ON public.capital_transactions USING btree (created_at DESC);


--
-- Name: idx_clients_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_phone ON public.clients USING btree (phone_number);


--
-- Name: idx_clients_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_status ON public.clients USING btree (status);


--
-- Name: idx_clients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_tenant ON public.clients USING btree (tenant_id);


--
-- Name: idx_customer_activities_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activities_customer ON public.customer_activities USING btree (platform_customer_id);


--
-- Name: idx_customer_activities_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activities_date ON public.customer_activities USING btree (created_at DESC);


--
-- Name: idx_customer_activities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_activities_tenant ON public.customer_activities USING btree (tenant_id);


--
-- Name: idx_demo_sessions_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_sessions_started ON public.demo_sessions USING btree (started_at DESC);


--
-- Name: idx_demo_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_sessions_token ON public.demo_sessions USING btree (session_token);


--
-- Name: idx_email_logs_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_client ON public.email_logs USING btree (client_id);


--
-- Name: idx_email_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_logs_date ON public.email_logs USING btree (created_at DESC);


--
-- Name: idx_invitations_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_code ON public.customer_invitations USING btree (invitation_code);


--
-- Name: idx_invitations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_tenant ON public.customer_invitations USING btree (tenant_id);


--
-- Name: idx_invoice_payments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_invoice ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);


--
-- Name: idx_links_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_links_client ON public.customer_tenant_links USING btree (client_id);


--
-- Name: idx_links_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_links_customer ON public.customer_tenant_links USING btree (platform_customer_id);


--
-- Name: idx_links_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_links_tenant ON public.customer_tenant_links USING btree (tenant_id);


--
-- Name: idx_loans_application_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_application_date ON public.loans USING btree (application_date);


--
-- Name: idx_loans_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_client ON public.loans USING btree (client_id);


--
-- Name: idx_loans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_status ON public.loans USING btree (status);


--
-- Name: idx_loans_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_tenant ON public.loans USING btree (tenant_id);


--
-- Name: idx_mpesa_tx_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_tx_checkout ON public.mpesa_transactions USING btree (checkout_request_id);


--
-- Name: idx_mpesa_tx_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_tx_invoice ON public.mpesa_transactions USING btree (invoice_id);


--
-- Name: idx_mpesa_tx_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_tx_loan ON public.mpesa_transactions USING btree (loan_id);


--
-- Name: idx_mpesa_tx_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_tx_status ON public.mpesa_transactions USING btree (status);


--
-- Name: idx_mpesa_tx_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_tx_tenant ON public.mpesa_transactions USING btree (tenant_id);


--
-- Name: idx_notif_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_date ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notif_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);


--
-- Name: idx_notif_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_user ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_status ON public.notifications USING btree (status);


--
-- Name: idx_payment_schedules_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_schedules_loan ON public.payment_schedules USING btree (loan_id);


--
-- Name: idx_payment_schedules_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_schedules_status ON public.payment_schedules USING btree (status);


--
-- Name: idx_platform_customers_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_customers_email ON public.platform_customers USING btree (email);


--
-- Name: idx_platform_customers_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_customers_id ON public.platform_customers USING btree (id_number);


--
-- Name: idx_platform_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_customers_phone ON public.platform_customers USING btree (phone_number);


--
-- Name: idx_referrals_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_code ON public.referrals USING btree (referral_code);


--
-- Name: idx_referrals_referred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referred ON public.referrals USING btree (referred_tenant_id);


--
-- Name: idx_referrals_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_referrer ON public.referrals USING btree (referrer_tenant_id);


--
-- Name: idx_referrals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referrals_status ON public.referrals USING btree (status);


--
-- Name: idx_sms_logs_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_logs_client ON public.sms_logs USING btree (client_id);


--
-- Name: idx_sms_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_logs_date ON public.sms_logs USING btree (created_at DESC);


--
-- Name: idx_sms_logs_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_logs_loan ON public.sms_logs USING btree (loan_id);


--
-- Name: idx_tenants_custom_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_custom_domain ON public.tenants USING btree (custom_domain) WHERE (custom_domain IS NOT NULL);


--
-- Name: idx_tenants_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_plan ON public.tenants USING btree (plan);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);


--
-- Name: idx_tenants_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_subdomain ON public.tenants USING btree (subdomain);


--
-- Name: idx_transactions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_client ON public.transactions USING btree (client_id);


--
-- Name: idx_transactions_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_loan ON public.transactions USING btree (loan_id);


--
-- Name: idx_transactions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_tenant ON public.transactions USING btree (tenant_id);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (is_active);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tenant ON public.users USING btree (tenant_id);


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: backups backups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: backups backups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: billing_activities billing_activities_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_activities
    ADD CONSTRAINT billing_activities_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- Name: billing_activities billing_activities_performed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_activities
    ADD CONSTRAINT billing_activities_performed_by_user_id_fkey FOREIGN KEY (performed_by_user_id) REFERENCES public.users(id);


--
-- Name: billing_activities billing_activities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_activities
    ADD CONSTRAINT billing_activities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: capital_pool capital_pool_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_pool
    ADD CONSTRAINT capital_pool_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: capital_transactions capital_transactions_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transactions
    ADD CONSTRAINT capital_transactions_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: capital_transactions capital_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transactions
    ADD CONSTRAINT capital_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: capital_transactions capital_transactions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capital_transactions
    ADD CONSTRAINT capital_transactions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: clients clients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.loan_packages
    ADD CONSTRAINT loan_packages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.loan_packages(id) ON DELETE SET NULL;


--
-- Name: company_settings company_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: customer_activities customer_activities_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activities
    ADD CONSTRAINT customer_activities_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: customer_activities customer_activities_platform_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activities
    ADD CONSTRAINT customer_activities_platform_customer_id_fkey FOREIGN KEY (platform_customer_id) REFERENCES public.platform_customers(id);


--
-- Name: customer_activities customer_activities_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activities
    ADD CONSTRAINT customer_activities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: customer_invitations customer_invitations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations
    ADD CONSTRAINT customer_invitations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: customer_invitations customer_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations
    ADD CONSTRAINT customer_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: customer_invitations customer_invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_invitations
    ADD CONSTRAINT customer_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: customer_tenant_links customer_tenant_links_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: customer_tenant_links customer_tenant_links_platform_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_platform_customer_id_fkey FOREIGN KEY (platform_customer_id) REFERENCES public.platform_customers(id) ON DELETE CASCADE;


--
-- Name: customer_tenant_links customer_tenant_links_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tenant_links
    ADD CONSTRAINT customer_tenant_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_logs email_logs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: email_logs email_logs_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: email_logs email_logs_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: email_logs email_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: invoice_payments invoice_payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(id);


--
-- Name: invoices invoices_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES public.users(id);


--
-- Name: invoices invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loans loans_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: loans loans_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: loans loans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: loans loans_disbursed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_disbursed_by_fkey FOREIGN KEY (disbursed_by) REFERENCES public.users(id);


--
-- Name: loans loans_platform_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_platform_customer_id_fkey FOREIGN KEY (platform_customer_id) REFERENCES public.platform_customers(id);


--
-- Name: loans loans_rejected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES public.users(id);


--
-- Name: loans loans_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: loans loans_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: mpesa_transactions mpesa_transactions_initiated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_initiated_by_user_id_fkey FOREIGN KEY (initiated_by_user_id) REFERENCES public.users(id);


--
-- Name: mpesa_transactions mpesa_transactions_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: mpesa_transactions mpesa_transactions_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id) ON DELETE SET NULL;


--
-- Name: mpesa_transactions mpesa_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: notifications notifications_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payment_schedules payment_schedules_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_schedules
    ADD CONSTRAINT payment_schedules_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: payment_schedules payment_schedules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_schedules
    ADD CONSTRAINT payment_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: platform_customers platform_customers_registration_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_customers
    ADD CONSTRAINT platform_customers_registration_tenant_id_fkey FOREIGN KEY (registration_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referred_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_tenant_id_fkey FOREIGN KEY (referred_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: referrals referrals_referrer_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_tenant_id_fkey FOREIGN KEY (referrer_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sms_logs sms_logs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: sms_logs sms_logs_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: sms_logs sms_logs_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: sms_logs sms_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenants tenants_referred_by_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_referred_by_tenant_id_fkey FOREIGN KEY (referred_by_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: transactions transactions_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: transactions transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 1abQRES8fLd9wgdDFWf3SkmnTgF6om34mRVLNtaA6FyHgbRiBIP5KxYHU4AccMx

--
-- customer_notifications (migration 016) — kept in sync with the migration
--
CREATE TABLE IF NOT EXISTS public.customer_notifications (
    id SERIAL PRIMARY KEY,
    platform_customer_id integer NOT NULL,
    tenant_id integer,
    loan_id integer,
    type character varying(30) NOT NULL,
    amount numeric(12,2),
    dedupe_key character varying(120) NOT NULL,
    is_read boolean DEFAULT false,
    is_dismissed boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    UNIQUE (platform_customer_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_cust_notif_customer
    ON public.customer_notifications (platform_customer_id, created_at DESC);


-- Auto-fill tenant_id on sms_logs / email_logs from the row's linked loan or
-- client, so per-tenant communication-cost reporting is accurate even when a
-- writer forgets tenant_id (matches migration 025).
CREATE OR REPLACE FUNCTION public.fill_log_tenant_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    IF NEW.loan_id IS NOT NULL THEN
      SELECT l.tenant_id INTO NEW.tenant_id FROM public.loans l WHERE l.id = NEW.loan_id;
    END IF;
    IF NEW.tenant_id IS NULL AND NEW.client_id IS NOT NULL THEN
      SELECT c.tenant_id INTO NEW.tenant_id FROM public.clients c WHERE c.id = NEW.client_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sms_logs_fill_tenant ON public.sms_logs;
CREATE TRIGGER sms_logs_fill_tenant
  BEFORE INSERT ON public.sms_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_log_tenant_id();

DROP TRIGGER IF EXISTS email_logs_fill_tenant ON public.email_logs;
CREATE TRIGGER email_logs_fill_tenant
  BEFORE INSERT ON public.email_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_log_tenant_id();

--
-- Expense categories + expenses (migrations 031, 032).
--

CREATE TABLE public.expense_categories (
  id           serial PRIMARY KEY,
  tenant_id    integer NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name         varchar(80) NOT NULL,
  icon         varchar(40),
  is_default   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  is_system    boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 100,
  created_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, name)
);

CREATE TABLE public.expenses (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id       integer REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  amount            numeric(15,2) NOT NULL CHECK (amount > 0),
  description       text,
  expense_date      date NOT NULL DEFAULT CURRENT_DATE,
  payment_method    varchar(40),
  reference         varchar(80),
  is_recurring      boolean NOT NULL DEFAULT false,
  recurrence_period varchar(20),
  recorded_by       integer REFERENCES public.users(id) ON DELETE SET NULL,
  invoice_id        integer REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uniq_expenses_invoice
  ON public.expenses (tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

--
-- Loan waivers (migration 035).
--

ALTER TABLE public.capital_pool
  ADD COLUMN IF NOT EXISTS total_waived numeric(15,2) NOT NULL DEFAULT 0;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS completed_via varchar(20);

CREATE TABLE public.loan_waivers (
  id              serial PRIMARY KEY,
  loan_id         integer NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  tenant_id       integer NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type            varchar(20) NOT NULL,
  amount          numeric(15,2) NOT NULL CHECK (amount > 0),
  reason          text NOT NULL,
  notes           text,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  requested_by    integer REFERENCES public.users(id) ON DELETE SET NULL,
  requested_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by     integer REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at     timestamp,
  rejected_by     integer REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at     timestamp,
  rejection_reason text,
  reversed_by     integer REFERENCES public.users(id) ON DELETE SET NULL,
  reversed_at     timestamp,
  reversal_reason text,
  allocation      jsonb,
  created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.promises_to_pay (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL REFERENCES public.tenants(id),
  loan_id          integer NOT NULL REFERENCES public.loans(id),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  promised_date    date NOT NULL,
  notes            text,
  status           varchar(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'partial', 'kept', 'cancelled')),
  made_at          timestamp NOT NULL DEFAULT NOW(),
  captured_by      integer REFERENCES public.users(id),
  resolved_at      timestamp,
  resolved_by      integer REFERENCES public.users(id),
  cancelled_reason text,
  updated_at       timestamp DEFAULT NOW()
);
CREATE INDEX idx_promises_loan   ON public.promises_to_pay(loan_id);
CREATE INDEX idx_promises_tenant ON public.promises_to_pay(tenant_id, status, promised_date);

--
-- Loan collateral (migration 048) — pledged item backing a pawn loan.
--

CREATE TABLE public.loan_collateral (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  loan_id          integer NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  category         varchar(60),
  description      text NOT NULL,
  serial_number    varchar(120),
  condition        varchar(40),
  appraised_value  numeric NOT NULL,
  ltv_percent      numeric NOT NULL DEFAULT 50,
  storage_location varchar(120),
  photos           jsonb,
  status           varchar(20) NOT NULL DEFAULT 'held',
  sale_amount      numeric,
  sale_date        date,
  returned_at      timestamp,
  forfeited_at     timestamp,
  created_by       integer,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_loan_collateral_loan   ON public.loan_collateral(loan_id);
CREATE INDEX idx_loan_collateral_tenant ON public.loan_collateral(tenant_id, status);

-- migration 065: pawn applications (customer-initiated)
CREATE TABLE public.pawn_applications (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  client_id        integer NOT NULL,
  item_description text,
  secured          boolean NOT NULL DEFAULT true,
  item_category    varchar(60),
  condition        varchar(40),
  serial_number    varchar(120),
  estimated_value  numeric(12,2),
  requested_amount numeric(12,2),
  photos           jsonb,
  status           varchar(20) NOT NULL DEFAULT 'pending',
  offered_amount   numeric(12,2),
  review_notes     text,
  reviewed_by      integer,
  reviewed_at      timestamp,
  loan_id          integer,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pawn_apps_tenant ON public.pawn_applications(tenant_id, status);
CREATE INDEX idx_pawn_apps_client ON public.pawn_applications(client_id);

-- migration 066: per-pawnshop settings
CREATE TABLE public.pawn_settings (
  tenant_id                 integer PRIMARY KEY,
  default_ltv_percent       numeric(5,2)  NOT NULL DEFAULT 50,
  default_monthly_fee_percent numeric(6,3) NOT NULL DEFAULT 10,
  default_duration_months   integer       NOT NULL DEFAULT 1,
  grace_days                integer       NOT NULL DEFAULT 0,
  auction_notice_days       integer       NOT NULL DEFAULT 14,
  created_at                timestamp NOT NULL DEFAULT NOW(),
  updated_at                timestamp NOT NULL DEFAULT NOW()
);

-- migration 067: pawn auctions (disposal workflow)
CREATE TABLE public.pawn_auctions (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  loan_id       integer NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'scheduled',
  auction_date  date,
  reserve_price numeric(12,2),
  sale_price    numeric(12,2),
  buyer_name    varchar(120),
  fees          numeric(12,2) NOT NULL DEFAULT 0,
  amount_owed   numeric(12,2),
  recovered     numeric(12,2) NOT NULL DEFAULT 0,
  surplus       numeric(12,2) NOT NULL DEFAULT 0,
  deficiency    numeric(12,2) NOT NULL DEFAULT 0,
  notes         text,
  created_by    integer,
  completed_by  integer,
  created_at    timestamp NOT NULL DEFAULT NOW(),
  updated_at    timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pawn_auctions_tenant ON public.pawn_auctions(tenant_id, status);
CREATE INDEX idx_pawn_auctions_loan   ON public.pawn_auctions(loan_id);

--
-- Vehicle security (migration 049) — logbook loans.
--

CREATE TABLE public.loan_vehicle_security (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  loan_id             integer NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  make                varchar(60),
  model               varchar(60),
  year                integer,
  registration_number varchar(40) NOT NULL,
  logbook_number      varchar(60),
  chassis_number      varchar(60),
  engine_number       varchar(60),
  color               varchar(40),
  valuation           numeric NOT NULL,
  logbook_held        boolean NOT NULL DEFAULT true,
  storage_location    varchar(120),
  lien_status         varchar(20) NOT NULL DEFAULT 'active',
  notes               text,
  released_at         timestamp,
  repossessed_at      timestamp,
  created_by          integer,
  created_at          timestamp NOT NULL DEFAULT NOW(),
  updated_at          timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id)
);
CREATE INDEX idx_loan_vehicle_loan   ON public.loan_vehicle_security(loan_id);
CREATE INDEX idx_loan_vehicle_tenant ON public.loan_vehicle_security(tenant_id, lien_status);

--
-- Salary check-off details (migration 050) — salary advances.
--

CREATE TABLE public.loan_salary_details (
  id                    serial PRIMARY KEY,
  tenant_id             integer NOT NULL,
  loan_id               integer NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  employer_name         varchar(120) NOT NULL,
  employer_contact      varchar(120),
  staff_number          varchar(60),
  net_monthly_pay       numeric NOT NULL,
  payday_day            integer,
  max_deduction_percent numeric NOT NULL DEFAULT 50,
  check_off_status      varchar(20) NOT NULL DEFAULT 'pending',
  notes                 text,
  activated_at          timestamp,
  stopped_at            timestamp,
  created_by            integer,
  created_at            timestamp NOT NULL DEFAULT NOW(),
  updated_at            timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id)
);
CREATE INDEX idx_loan_salary_loan   ON public.loan_salary_details(loan_id);
CREATE INDEX idx_loan_salary_tenant ON public.loan_salary_details(tenant_id, check_off_status);

--
-- Group / chama lending (migration 051).
--

CREATE TABLE public.groups (
  id                serial PRIMARY KEY,
  tenant_id         integer NOT NULL,
  group_code        varchar(30),
  name              varchar(120) NOT NULL,
  branch_id         integer,
  registration_no   varchar(60),
  meeting_frequency varchar(20),
  status            varchar(20) NOT NULL DEFAULT 'active',
  notes             text,
  created_by        integer,
  created_at        timestamp NOT NULL DEFAULT NOW(),
  updated_at        timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE public.group_members (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  group_id    integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  client_id   integer NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role        varchar(20) NOT NULL DEFAULT 'member',
  status      varchar(20) NOT NULL DEFAULT 'active',
  joined_at   date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, client_id)
);
CREATE INDEX idx_groups_tenant        ON public.groups(tenant_id, status);
CREATE INDEX idx_group_members_group  ON public.group_members(group_id, status);
CREATE INDEX idx_group_members_client ON public.group_members(client_id);
CREATE INDEX idx_loans_group          ON public.loans(group_id);

--
-- Group savings + joint-liability coverage (migration 052).
--

CREATE TABLE public.group_savings_transactions (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  group_id       integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  client_id      integer REFERENCES public.clients(id) ON DELETE SET NULL,
  type           varchar(24) NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  direction      smallint NOT NULL,
  balance_after  numeric NOT NULL,
  loan_id        integer REFERENCES public.loans(id) ON DELETE SET NULL,
  txn_date       date NOT NULL DEFAULT CURRENT_DATE,
  description    text,
  created_by     integer,
  created_at     timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_group_savings_group  ON public.group_savings_transactions(group_id, id);
CREATE INDEX idx_group_savings_client ON public.group_savings_transactions(client_id);

--
-- Group meetings + attendance (migration 053).
--

CREATE TABLE public.group_meetings (
  id           serial PRIMARY KEY,
  tenant_id    integer NOT NULL,
  group_id     integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  location     varchar(120),
  agenda       text,
  title        varchar(120), -- migration 086
  penalty_rule_id integer, -- migration 087
  fine_late    numeric, -- migration 088
  fine_absent  numeric, -- migration 088
  start_time   time, -- migration 099
  grace_minutes integer NOT NULL DEFAULT 0, -- migration 099
  notes        text,
  status       varchar(20) NOT NULL DEFAULT 'scheduled',
  created_by   integer,
  created_at   timestamp NOT NULL DEFAULT NOW(),
  updated_at   timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE public.group_meeting_attendance (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  meeting_id  integer NOT NULL REFERENCES public.group_meetings(id) ON DELETE CASCADE,
  client_id   integer NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status      varchar(20) NOT NULL DEFAULT 'present',
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, client_id)
);
CREATE INDEX idx_group_meetings_group ON public.group_meetings(group_id, meeting_date);
CREATE INDEX idx_meeting_attendance_meeting ON public.group_meeting_attendance(meeting_id);
CREATE INDEX idx_meeting_attendance_client ON public.group_meeting_attendance(client_id);

--
-- Group lending cycles / rounds (migration 054).
--

CREATE TABLE public.group_cycles (
  id           serial PRIMARY KEY,
  tenant_id    integer NOT NULL,
  group_id     integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL,
  name         varchar(80),
  start_date   date,
  end_date     date,
  status       varchar(20) NOT NULL DEFAULT 'open',
  notes        text,
  created_by   integer,
  created_at   timestamp NOT NULL DEFAULT NOW(),
  updated_at   timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, cycle_number)
);
CREATE INDEX idx_group_cycles_group ON public.group_cycles(group_id, status);
CREATE INDEX idx_loans_cycle ON public.loans(cycle_id);

--
-- Member contributions pool (migration 055) — separate from capital_pool.
--

CREATE TABLE public.members (
  id                   serial PRIMARY KEY,
  tenant_id            integer NOT NULL,
  welfare_id           integer,  -- migration 057 (members belong to a welfare/group)
  member_no            varchar(30),
  first_name           varchar(60) NOT NULL,
  last_name            varchar(60) NOT NULL,
  phone_number         varchar(20),
  id_number            varchar(30),
  email                varchar(120),
  status               varchar(20) NOT NULL DEFAULT 'active',
  monthly_contribution numeric,
  joined_at            date NOT NULL DEFAULT CURRENT_DATE,
  notes                text,
  role                 varchar(20) NOT NULL DEFAULT 'member', -- migration 096 (member|chair|treasurer|secretary)
  created_by           integer,
  created_at           timestamp NOT NULL DEFAULT NOW(),
  updated_at           timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_chair_per_welfare
  ON public.members(welfare_id) WHERE role = 'chair' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_treasurer_per_welfare
  ON public.members(welfare_id) WHERE role = 'treasurer' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_one_secretary_per_welfare
  ON public.members(welfare_id) WHERE role = 'secretary' AND status = 'active';

CREATE TABLE public.welfare_documents ( -- migration 097
  id                 serial PRIMARY KEY,
  tenant_id          integer NOT NULL,
  welfare_id         integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title              varchar(160) NOT NULL,
  category           varchar(20) NOT NULL DEFAULT 'other',
  visibility         varchar(20) NOT NULL DEFAULT 'members',
  file_url           text NOT NULL,
  file_name          varchar(200),
  mime               varchar(100),
  size_bytes         integer,
  meeting_id         integer,
  uploaded_by_member integer REFERENCES public.members(id) ON DELETE SET NULL,
  uploaded_by_user   integer,
  uploaded_by_name   varchar(120),
  created_at         timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_documents_welfare ON public.welfare_documents(welfare_id, created_at DESC);

CREATE TABLE public.welfare_decisions ( -- migration 098
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  welfare_id       integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  type             varchar(20) NOT NULL DEFAULT 'motion',
  title            varchar(160) NOT NULL,
  description      text,
  status           varchar(20) NOT NULL DEFAULT 'open',
  quorum_percent   integer NOT NULL DEFAULT 50,
  closes_at        timestamp,
  opened_by_member integer REFERENCES public.members(id) ON DELETE SET NULL,
  opened_by_user   integer,
  opened_by_name   varchar(120),
  target_member_id integer REFERENCES public.members(id) ON DELETE SET NULL,
  target_role      varchar(20),
  resolved_at      timestamp,
  created_at       timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_decisions_welfare ON public.welfare_decisions(welfare_id, created_at DESC);

CREATE TABLE public.welfare_investments ( -- migration 100
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name            varchar(120) NOT NULL,
  amount_invested numeric(15,2) NOT NULL DEFAULT 0,
  current_balance numeric(15,2) NOT NULL DEFAULT 0,
  interest_earned numeric(15,2) NOT NULL DEFAULT 0, -- migration 101
  withdrawn       numeric(15,2) NOT NULL DEFAULT 0, -- migration 101
  notes           text,
  created_by      integer,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_investments_welfare ON public.welfare_investments(welfare_id);

CREATE TABLE public.welfare_investment_transactions ( -- migration 101
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  investment_id integer NOT NULL REFERENCES public.welfare_investments(id) ON DELETE CASCADE,
  type          varchar(20) NOT NULL,
  amount        numeric(15,2) NOT NULL,
  balance_after numeric(15,2) NOT NULL,
  note          text,
  txn_date      date NOT NULL DEFAULT CURRENT_DATE,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_welfare_investment_txns ON public.welfare_investment_transactions(investment_id, id);

CREATE TABLE public.welfare_decision_votes ( -- migration 098
  id          serial PRIMARY KEY,
  decision_id integer NOT NULL REFERENCES public.welfare_decisions(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  vote        varchar(10) NOT NULL,
  comment     text,
  voted_at    timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (decision_id, member_id)
);

CREATE TABLE public.member_pool_transactions (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  welfare_id     integer,  -- migration 057
  member_id      integer REFERENCES public.members(id) ON DELETE SET NULL,
  type           varchar(24) NOT NULL,
  amount         numeric NOT NULL CHECK (amount > 0),
  direction      smallint NOT NULL,
  balance_after  numeric NOT NULL,
  member_loan_id integer,
  txn_date       date NOT NULL DEFAULT CURRENT_DATE,
  description    text,
  created_by     integer,
  dividend_distribution_id integer,  -- migration 063
  created_at     timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE public.dividend_distributions (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  welfare_id    integer NOT NULL,
  total_amount  numeric(15,2) NOT NULL,
  basis         varchar(20) NOT NULL DEFAULT 'savings',
  member_count  integer NOT NULL DEFAULT 0,
  notes         text,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_members_tenant ON public.members(tenant_id, status);
CREATE INDEX idx_members_welfare ON public.members(welfare_id);
CREATE INDEX idx_member_pool_tenant ON public.member_pool_transactions(tenant_id, id);
CREATE INDEX idx_member_pool_member ON public.member_pool_transactions(member_id);
CREATE INDEX idx_member_pool_welfare ON public.member_pool_transactions(welfare_id, id);

--
-- Member loan products (migration 089).
--

CREATE TABLE public.member_loan_products (
  id                   serial PRIMARY KEY,
  tenant_id            integer NOT NULL,
  welfare_id           integer NOT NULL,
  name                 varchar(80) NOT NULL,
  description          text,
  annual_interest_rate numeric(6,2) NOT NULL CHECK (annual_interest_rate >= 0),
  interest_method      varchar(20) NOT NULL DEFAULT 'flat'
                         CHECK (interest_method IN ('flat', 'reducing')),
  processing_fee_rate  numeric(5,2) NOT NULL DEFAULT 0
                         CHECK (processing_fee_rate >= 0 AND processing_fee_rate <= 100),
  min_amount           numeric(15,2) NOT NULL CHECK (min_amount > 0),
  max_amount           numeric(15,2) NOT NULL CHECK (max_amount >= min_amount),
  min_duration_months  integer NOT NULL CHECK (min_duration_months > 0),
  max_duration_months  integer NOT NULL CHECK (max_duration_months >= min_duration_months),
  late_fee             numeric(14,2) NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  penalty_rate         numeric(6,3) NOT NULL DEFAULT 0 CHECK (penalty_rate >= 0),
  active               boolean NOT NULL DEFAULT true,
  created_by           integer,
  created_at           timestamp NOT NULL DEFAULT NOW(),
  updated_at           timestamp NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX member_loan_products_welfare_name_active_unique
  ON public.member_loan_products (welfare_id, lower((name)::text)) WHERE active;
CREATE INDEX idx_member_loan_products_welfare ON public.member_loan_products (welfare_id);

--
-- Member loans funded by the member pool (migration 056; parity cols 090).
--

CREATE TABLE public.member_loans (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  member_id        integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  loan_code        varchar(30),
  principal        numeric NOT NULL,
  interest_rate    numeric NOT NULL DEFAULT 0,
  duration_months  integer NOT NULL DEFAULT 1,
  total_interest   numeric NOT NULL DEFAULT 0,
  total_amount_due numeric NOT NULL,
  amount_paid      numeric NOT NULL DEFAULT 0,
  status           varchar(20) NOT NULL DEFAULT 'active',
  disbursed_at     timestamp,
  due_date         date,
  notes            text,
  created_by       integer,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW(),
  -- migration 090 (lender parity)
  product_id          integer REFERENCES public.member_loan_products(id) ON DELETE SET NULL,
  welfare_id          integer,
  interest_method     varchar(20) NOT NULL DEFAULT 'flat',
  processing_fee_rate numeric(5,2) NOT NULL DEFAULT 0,
  processing_fee      numeric(14,2) NOT NULL DEFAULT 0,
  net_disbursed       numeric(14,2),
  late_fee            numeric(14,2) NOT NULL DEFAULT 0,
  penalty_rate        numeric(6,3) NOT NULL DEFAULT 0,
  purpose             text,
  start_date          date,
  end_date            date,
  reviewed_by         integer,
  reviewed_at         timestamp,
  approved_by         integer,
  approved_at         timestamp,
  rejected_by         integer,
  rejected_at         timestamp,
  rejection_reason    text,
  disbursed_by        integer,
  counter_principal   numeric(14,2),
  counter_rate        numeric(6,3),
  counter_duration_months integer,
  counter_notes       text
);
CREATE INDEX idx_member_loans_member ON public.member_loans(member_id);
CREATE INDEX idx_member_loans_tenant ON public.member_loans(tenant_id, status);
CREATE INDEX idx_member_loans_welfare ON public.member_loans(welfare_id, status);

--
-- Member loan installment schedules (migration 091).
--

CREATE TABLE public.member_loan_schedules (
  id                       serial PRIMARY KEY,
  tenant_id                integer NOT NULL,
  member_loan_id           integer NOT NULL REFERENCES public.member_loans(id) ON DELETE CASCADE,
  payment_number           integer NOT NULL,
  due_date                 date NOT NULL,
  amount_due               numeric(14,2) NOT NULL,
  amount_paid              numeric(14,2) NOT NULL DEFAULT 0,
  interest_portion         numeric(14,2) NOT NULL DEFAULT 0,
  principal_portion        numeric(14,2) NOT NULL DEFAULT 0,
  balance_after            numeric(14,2) NOT NULL DEFAULT 0,
  interest_paid            numeric(14,2) NOT NULL DEFAULT 0,
  penalty_paid             numeric(14,2) NOT NULL DEFAULT 0,
  late_fee_charged         numeric(14,2) NOT NULL DEFAULT 0,
  penalty_interest_charged numeric(14,2) NOT NULL DEFAULT 0,
  actual_payment_date      date,
  days_late                integer NOT NULL DEFAULT 0,
  status                   varchar(20) NOT NULL DEFAULT 'pending',
  created_at               timestamp NOT NULL DEFAULT NOW(),
  updated_at               timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (member_loan_id, payment_number)
);
CREATE INDEX idx_member_loan_schedules_loan ON public.member_loan_schedules(member_loan_id);

--
-- Member loan collateral (migration 092).
--

CREATE TABLE public.member_loan_collateral (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  member_loan_id   integer NOT NULL REFERENCES public.member_loans(id) ON DELETE CASCADE,
  category         varchar(60),
  description      text NOT NULL,
  serial_number    varchar(120),
  condition        varchar(40),
  appraised_value  numeric NOT NULL,
  ltv_percent      numeric NOT NULL DEFAULT 50,
  storage_location varchar(120),
  photos           jsonb,
  status           varchar(20) NOT NULL DEFAULT 'held',
  sale_amount      numeric,
  sale_date        date,
  returned_at      timestamp,
  forfeited_at     timestamp,
  created_by       integer,
  created_at       timestamp NOT NULL DEFAULT NOW(),
  updated_at       timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_member_loan_collateral_loan ON public.member_loan_collateral(member_loan_id);

--
-- Member loan guarantors (migration 093).
--

CREATE TABLE public.member_loan_guarantors (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  member_loan_id      integer NOT NULL REFERENCES public.member_loans(id) ON DELETE CASCADE,
  guarantor_member_id integer REFERENCES public.members(id) ON DELETE SET NULL,
  guarantor_name      varchar(120),
  guarantor_phone     varchar(30),
  guarantor_id_number varchar(40),
  guaranteed_amount   numeric(14,2),
  status              varchar(20) NOT NULL DEFAULT 'active',
  created_by          integer,
  created_at          timestamp NOT NULL DEFAULT NOW(),
  updated_at          timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_member_loan_guarantors_loan ON public.member_loan_guarantors(member_loan_id);

CREATE TABLE public.member_loan_requests (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL,
  member_id       integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  principal       numeric(14,2) NOT NULL,
  duration_months integer NOT NULL DEFAULT 1,
  interest_rate   numeric(6,3),
  purpose         text,
  status          varchar(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','counter_offered')),
  reviewed_by     integer,
  decision_notes  text,
  issued_loan_id  integer REFERENCES public.member_loans(id) ON DELETE SET NULL,
  product_id      integer REFERENCES public.member_loan_products(id) ON DELETE SET NULL,
  interest_method varchar(20) NOT NULL DEFAULT 'flat',
  created_at      timestamp NOT NULL DEFAULT now(),
  decided_at      timestamp
);

CREATE TABLE public.member_withdrawal_requests (
  id              serial PRIMARY KEY,
  tenant_id       integer NOT NULL,
  welfare_id      integer NOT NULL,
  member_id       integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL,
  reason          text,
  status          varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     integer,
  decision_notes  text,
  pool_txn_id     integer REFERENCES public.member_pool_transactions(id) ON DELETE SET NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  decided_at      timestamp
);

--
-- Welfare settings + penalty engine (migration 059).
--

CREATE TABLE public.welfare_settings (
  tenant_id                integer PRIMARY KEY,
  contribution_frequency   varchar(20) NOT NULL DEFAULT 'monthly',
  contribution_amount      numeric,
  contribution_grace_days  integer NOT NULL DEFAULT 0,
  attendance_grace_minutes integer NOT NULL DEFAULT 0,
  loans_enabled            boolean NOT NULL DEFAULT false, -- migration 095
  default_loan_interest_rate       numeric(6,2),            -- migration 102
  default_loan_interest_method     varchar(20) NOT NULL DEFAULT 'flat',
  default_loan_processing_fee_rate numeric(5,2) NOT NULL DEFAULT 0,
  default_loan_late_fee            numeric(14,2) NOT NULL DEFAULT 0,
  default_loan_penalty_rate        numeric(6,3) NOT NULL DEFAULT 0,
  created_at               timestamp NOT NULL DEFAULT NOW(),
  updated_at               timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE public.penalty_rules (
  id         serial PRIMARY KEY,
  tenant_id  integer NOT NULL,
  trigger    varchar(30) NOT NULL,
  calc_type  varchar(20) NOT NULL,
  amount     numeric,
  rate       numeric,
  cap        numeric,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_by integer,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE public.penalty_assessments (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  member_id   integer REFERENCES public.members(id) ON DELETE CASCADE,
  rule_id     integer,
  trigger     varchar(30) NOT NULL,
  source_type varchar(30),
  source_id   integer,
  amount      numeric NOT NULL CHECK (amount > 0),
  paid_amount numeric NOT NULL DEFAULT 0,
  status      varchar(20) NOT NULL DEFAULT 'outstanding',
  description text,
  assessed_at timestamp NOT NULL DEFAULT NOW(),
  created_by  integer
);
CREATE INDEX idx_penalty_rules_tenant ON public.penalty_rules(tenant_id, active);
CREATE INDEX idx_penalty_assessments_tenant ON public.penalty_assessments(tenant_id, status);
CREATE INDEX idx_penalty_assessments_member ON public.penalty_assessments(member_id);

--
-- Welfare contribution cycles + schedules (migration 060).
--

-- Recurring contribution plans (migration 081).
CREATE TABLE public.contribution_plans (
  id             serial PRIMARY KEY,
  tenant_id      integer NOT NULL,
  welfare_id     integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name           varchar(80) NOT NULL DEFAULT 'Monthly contribution',
  frequency      varchar(20) NOT NULL DEFAULT 'monthly',
  amount         numeric NOT NULL,
  due_day        integer NOT NULL DEFAULT 10,
  due_month      integer,
  grace_days     integer NOT NULL DEFAULT 0,
  fine_calc_type varchar(20),
  fine_amount    numeric,
  fine_rate      numeric,
  fine_cap       numeric,
  active         boolean NOT NULL DEFAULT true,
  pool_kind      varchar(16) NOT NULL DEFAULT 'savings', -- migration 085 (savings | benefit)
  penalty_rule_id integer, -- migration 086
  created_by     integer,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_contribution_plan_name ON public.contribution_plans(welfare_id, lower(name)) WHERE active;

CREATE TABLE public.contribution_cycles (
  id           serial PRIMARY KEY,
  tenant_id    integer NOT NULL,
  welfare_id   integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name         varchar(80) NOT NULL,
  frequency    varchar(20) NOT NULL DEFAULT 'monthly',
  amount       numeric NOT NULL,
  period_start date,
  due_date     date NOT NULL,
  status       varchar(20) NOT NULL DEFAULT 'open',
  notes        text,
  created_by   integer,
  created_at   timestamp NOT NULL DEFAULT NOW(),
  updated_at   timestamp NOT NULL DEFAULT NOW(),
  category     varchar(20) NOT NULL DEFAULT 'savings', -- migration 078 (savings credits equity)
  plan_id        integer REFERENCES public.contribution_plans(id) ON DELETE SET NULL, -- migration 081
  period_key     varchar(16),
  grace_days     integer,
  fine_calc_type varchar(20),
  fine_amount    numeric,
  fine_rate      numeric,
  fine_cap       numeric,
  pool_key              varchar(32) NOT NULL DEFAULT 'savings', -- migration 085
  beneficiary_member_id integer REFERENCES public.members(id) ON DELETE SET NULL,
  penalty_rule_id       integer -- migration 086
);
CREATE UNIQUE INDEX uq_cycle_plan_period ON public.contribution_cycles(plan_id, period_key) WHERE plan_id IS NOT NULL AND period_key IS NOT NULL;

-- migration 085: benefit-pool ledger (quarterly / one-off emergencies)
CREATE TABLE public.benefit_pool_ledger (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  welfare_id    integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  pool_key      varchar(32) NOT NULL,
  member_id     integer REFERENCES public.members(id) ON DELETE SET NULL,
  type          varchar(24) NOT NULL,
  cycle_id      integer REFERENCES public.contribution_cycles(id) ON DELETE SET NULL,
  amount        numeric(14,2) NOT NULL,
  direction     smallint NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  txn_date      date NOT NULL DEFAULT CURRENT_DATE,
  description   text,
  created_by    integer,
  meeting_id    integer, -- migration 086
  created_at    timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_benefit_pool_ledger_pool ON public.benefit_pool_ledger(welfare_id, pool_key, id);

CREATE TABLE public.contribution_schedules (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  cycle_id    integer NOT NULL REFERENCES public.contribution_cycles(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount_due  numeric NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  due_date    date NOT NULL,
  status      varchar(20) NOT NULL DEFAULT 'pending',
  paid_at     timestamp,
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, member_id)
);
CREATE INDEX idx_contrib_cycles_welfare ON public.contribution_cycles(welfare_id, status);
CREATE INDEX idx_contrib_schedules_cycle ON public.contribution_schedules(cycle_id);
CREATE INDEX idx_contrib_schedules_member ON public.contribution_schedules(member_id);

-- Welfare EVENTS — ad-hoc member payouts funded by a separate events pool (migration 078).
CREATE TABLE public.welfare_events (
  id                    serial PRIMARY KEY,
  tenant_id             integer NOT NULL,
  welfare_id            integer NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title                 varchar(120) NOT NULL,
  description           text,
  beneficiary_member_id integer NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  amount                numeric NOT NULL CHECK (amount > 0),
  due_date              date,
  needed_by             date,
  funding_mode          varchar(20),
  shortfall_amount      numeric NOT NULL DEFAULT 0,
  bridged_amount        numeric NOT NULL DEFAULT 0,
  bridge_repaid         numeric NOT NULL DEFAULT 0,
  disbursed_amount      numeric NOT NULL DEFAULT 0,
  disbursed_at          timestamp,
  status                varchar(20) NOT NULL DEFAULT 'open',
  notes                 text,
  created_by            integer,
  created_at            timestamp NOT NULL DEFAULT NOW(),
  updated_at            timestamp NOT NULL DEFAULT NOW()
);
CREATE TABLE public.welfare_event_shares (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  event_id    integer NOT NULL REFERENCES public.welfare_events(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount_due  numeric NOT NULL,
  amount_paid numeric NOT NULL DEFAULT 0,
  status      varchar(20) NOT NULL DEFAULT 'pending',
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, member_id)
);
CREATE TABLE public.welfare_event_ledger (
  id            serial PRIMARY KEY,
  tenant_id     integer NOT NULL,
  welfare_id    integer NOT NULL,
  event_id      integer REFERENCES public.welfare_events(id) ON DELETE SET NULL,
  member_id     integer REFERENCES public.members(id) ON DELETE SET NULL,
  type          varchar(24) NOT NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  direction     smallint NOT NULL,
  balance_after numeric NOT NULL,
  txn_date      date NOT NULL DEFAULT CURRENT_DATE,
  description   text,
  created_by    integer,
  created_at    timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_welfare_events_welfare ON public.welfare_events(welfare_id, status);
CREATE INDEX idx_welfare_event_shares_event ON public.welfare_event_shares(event_id);
CREATE INDEX idx_welfare_event_shares_member ON public.welfare_event_shares(member_id);
CREATE INDEX idx_welfare_event_ledger_welfare ON public.welfare_event_ledger(welfare_id, id);

-- Member-initiated event-fund requests (migration 080).
CREATE TABLE public.member_event_requests (
  id               serial PRIMARY KEY,
  tenant_id        integer NOT NULL,
  welfare_id       integer NOT NULL,
  member_id        integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL,
  event_date       date,
  reason           text,
  status           varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      integer,
  decision_notes   text,
  created_event_id integer REFERENCES public.welfare_events(id) ON DELETE SET NULL,
  created_at       timestamp NOT NULL DEFAULT now(),
  decided_at       timestamp
);
CREATE INDEX idx_member_event_requests_welfare ON public.member_event_requests(welfare_id, status);
CREATE INDEX idx_member_event_requests_member ON public.member_event_requests(member_id);

--
-- Welfare meeting attendance over members (migration 061).
--

CREATE TABLE public.member_attendance (
  id          serial PRIMARY KEY,
  tenant_id   integer NOT NULL,
  welfare_id  integer NOT NULL,
  meeting_id  integer NOT NULL REFERENCES public.group_meetings(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  status      varchar(20) NOT NULL DEFAULT 'present',
  arrival_time time, -- migration 099
  apology     boolean NOT NULL DEFAULT false, -- migration 099
  created_at  timestamp NOT NULL DEFAULT NOW(),
  updated_at  timestamp NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, member_id)
);
CREATE INDEX idx_member_attendance_meeting ON public.member_attendance(meeting_id);
CREATE INDEX idx_member_attendance_member ON public.member_attendance(member_id);
