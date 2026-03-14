--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
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
-- Name: algorithm_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.algorithm_metrics (
    id integer NOT NULL,
    org_id character varying(50) NOT NULL,
    date date NOT NULL,
    self_consumption_pct numeric(5,2)
);


--
-- Name: algorithm_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.algorithm_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: algorithm_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.algorithm_metrics_id_seq OWNED BY public.algorithm_metrics.id;


--
-- Name: asset_5min_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics (
    id bigint NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (window_start);


--
-- Name: asset_5min_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.asset_5min_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asset_5min_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.asset_5min_metrics_id_seq OWNED BY public.asset_5min_metrics.id;


--
-- Name: asset_5min_metrics_20260306; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260306 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260307; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260307 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260308; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260308 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260309; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260309 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260310; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260310 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260311; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260311 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260312; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260312 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260313; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260313 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260314; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260314 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260315; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260315 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260316; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260316 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260317; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260317 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260318; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260318 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260319; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260319 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260320; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260320 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260321; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260321 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260322; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260322 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260323; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260323 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260324; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260324 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260325; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260325 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260326; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260326 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260327; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260327 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260328; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260328 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260329; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260329 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260330; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260330 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260331; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260331 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260401; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260401 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260402; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260402 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260403; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260403 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260404; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260404 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260405; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260405 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_5min_metrics_20260406; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_5min_metrics_20260406 (
    id bigint DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    window_start timestamp with time zone NOT NULL,
    pv_energy_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_import_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    grid_export_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    load_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    bat_charge_from_grid_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    avg_battery_soc numeric(5,2),
    data_points integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: asset_hourly_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_hourly_metrics (
    id bigint NOT NULL,
    asset_id character varying(200) NOT NULL,
    hour_timestamp timestamp with time zone NOT NULL,
    total_charge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    total_discharge_kwh numeric(10,4) DEFAULT 0 NOT NULL,
    data_points_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avg_battery_soh real,
    avg_battery_voltage real,
    avg_battery_temperature real
);


--
-- Name: asset_hourly_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.asset_hourly_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: asset_hourly_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.asset_hourly_metrics_id_seq OWNED BY public.asset_hourly_metrics.id;


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    asset_id character varying(200) NOT NULL,
    org_id character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    region character varying(10),
    capacidade_kw numeric(6,2),
    capacity_kwh numeric(6,2) NOT NULL,
    operation_mode character varying(50),
    submercado character varying(10) DEFAULT 'SUDESTE'::character varying NOT NULL,
    retail_buy_rate_kwh numeric(8,4) DEFAULT 0.80 NOT NULL,
    retail_sell_rate_kwh numeric(8,4) DEFAULT 0.25 NOT NULL,
    asset_type character varying(30) DEFAULT 'INVERTER_BATTERY'::character varying NOT NULL,
    brand character varying(100),
    model character varying(100),
    serial_number character varying(200),
    commissioned_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    investimento_brl numeric(14,2),
    roi_pct numeric(5,2),
    payback_str character varying(10),
    receita_mes_brl numeric(12,2),
    installation_cost_reais numeric(12,2),
    soc_min_pct real DEFAULT 10,
    max_charge_rate_kw real,
    max_discharge_rate_kw real,
    allow_export boolean DEFAULT false NOT NULL,
    gateway_id character varying(50),
    rated_max_power_kw real,
    rated_max_current_a real,
    rated_min_power_kw real,
    rated_min_current_a real,
    CONSTRAINT assets_asset_type_check CHECK (((asset_type)::text = ANY ((ARRAY['INVERTER_BATTERY'::character varying, 'SMART_METER'::character varying, 'HVAC'::character varying, 'EV_CHARGER'::character varying, 'SOLAR_PANEL'::character varying])::text[]))),
    CONSTRAINT assets_submercado_check CHECK (((submercado)::text = ANY ((ARRAY['SUDESTE'::character varying, 'SUL'::character varying, 'NORDESTE'::character varying, 'NORTE'::character varying])::text[])))
);


--
-- Name: backfill_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backfill_requests (
    id bigint NOT NULL,
    gateway_id character varying NOT NULL,
    gap_start timestamp with time zone NOT NULL,
    gap_end timestamp with time zone NOT NULL,
    current_chunk_start timestamp with time zone,
    last_chunk_sent_at timestamp with time zone,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT chk_backfill_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: backfill_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backfill_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backfill_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backfill_requests_id_seq OWNED BY public.backfill_requests.id;


--
-- Name: daily_uptime_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_uptime_snapshots (
    id integer NOT NULL,
    org_id character varying(50) NOT NULL,
    date date NOT NULL,
    total_assets integer NOT NULL,
    online_assets integer NOT NULL,
    uptime_pct numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: daily_uptime_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_uptime_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_uptime_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_uptime_snapshots_id_seq OWNED BY public.daily_uptime_snapshots.id;


--
-- Name: data_dictionary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_dictionary (
    field_id character varying(100) NOT NULL,
    domain character varying(20) NOT NULL,
    display_name character varying(200) NOT NULL,
    value_type character varying(20) NOT NULL,
    unit character varying(20),
    is_protected boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_command_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_command_logs (
    id bigint NOT NULL,
    gateway_id character varying(50) NOT NULL,
    command_type character varying(20) NOT NULL,
    config_name character varying(100) DEFAULT 'battery_schedule'::character varying NOT NULL,
    message_id character varying(50),
    payload_json jsonb,
    result character varying(20),
    error_message text,
    device_timestamp timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id character varying(50),
    source character varying(10) DEFAULT 'p2'::character varying,
    CONSTRAINT device_command_logs_command_type_check CHECK (((command_type)::text = ANY ((ARRAY['get'::character varying, 'get_reply'::character varying, 'set'::character varying, 'set_reply'::character varying])::text[])))
);


--
-- Name: TABLE device_command_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_command_logs IS 'M1 IoT Hub: tracks config get/set commands and their async replies.';


--
-- Name: COLUMN device_command_logs.command_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_command_logs.command_type IS 'get = request sent, get_reply = response received, set = config pushed, set_reply = ack received.';


--
-- Name: COLUMN device_command_logs.device_timestamp; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_command_logs.device_timestamp IS 'Parsed from payload.timeStamp (epoch ms). Device clock, not server clock.';


--
-- Name: COLUMN device_command_logs.batch_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_command_logs.batch_id IS 'P4 批量操作 ID，null = 單筆操作（P2/自動）';


--
-- Name: COLUMN device_command_logs.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.device_command_logs.source IS '指令來源：p2=手動單台, p4=批量, auto=M2自動排程';


--
-- Name: COLUMN assets.rated_max_power_kw; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assets.rated_max_power_kw IS 'Gateway MQTT deviceList 回報的額定最大功率 (kW)，硬體銘牌值';


--
-- Name: COLUMN assets.rated_max_current_a; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assets.rated_max_current_a IS 'Gateway MQTT deviceList 回報的額定最大電流 (A)，硬體銘牌值';


--
-- Name: COLUMN assets.rated_min_power_kw; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assets.rated_min_power_kw IS 'Gateway MQTT deviceList 回報的額定最小功率 (kW)';


--
-- Name: COLUMN assets.rated_min_current_a; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.assets.rated_min_current_a IS 'Gateway MQTT deviceList 回報的額定最小電流 (A)';


--
-- Name: device_command_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_command_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_command_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_command_logs_id_seq OWNED BY public.device_command_logs.id;


--
-- Name: device_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_state (
    asset_id character varying(200) NOT NULL,
    battery_soc numeric(5,2),
    bat_soh numeric(5,2),
    bat_work_status character varying(20),
    battery_voltage numeric(6,2),
    bat_cycle_count integer,
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    inverter_temp numeric(5,2),
    is_online boolean DEFAULT false NOT NULL,
    grid_frequency numeric(6,3),
    telemetry_json jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pv_daily_energy numeric(10,3) DEFAULT 0,
    bat_charged_today numeric(10,3) DEFAULT 0,
    bat_discharged_today numeric(10,3) DEFAULT 0,
    grid_import_kwh numeric(10,3) DEFAULT 0,
    grid_export_kwh numeric(10,3) DEFAULT 0
);


--
-- Name: dispatch_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_commands (
    id integer NOT NULL,
    trade_id integer,
    asset_id character varying(200) NOT NULL,
    org_id character varying(50) NOT NULL,
    action character varying(20) NOT NULL,
    volume_kwh numeric(8,2),
    status character varying(20) DEFAULT 'dispatched'::character varying NOT NULL,
    m1_boundary boolean DEFAULT true NOT NULL,
    dispatched_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dispatch_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispatch_commands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispatch_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispatch_commands_id_seq OWNED BY public.dispatch_commands.id;


--
-- Name: dispatch_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_records (
    id integer NOT NULL,
    asset_id character varying(200) NOT NULL,
    dispatched_at timestamp with time zone NOT NULL,
    dispatch_type character varying(50),
    commanded_power_kw numeric(8,3),
    actual_power_kw numeric(8,3),
    success boolean,
    response_latency_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_mode character varying(50)
);


--
-- Name: dispatch_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispatch_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispatch_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispatch_records_id_seq OWNED BY public.dispatch_records.id;


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    id integer NOT NULL,
    flag_name character varying(100) NOT NULL,
    org_id character varying(50),
    is_enabled boolean DEFAULT false NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feature_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.feature_flags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: feature_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.feature_flags_id_seq OWNED BY public.feature_flags.id;


--
-- Name: gateways; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateways (
    gateway_id character varying(50) NOT NULL,
    org_id character varying(50) NOT NULL,
    mqtt_broker_host character varying(255) DEFAULT '18.141.63.142'::character varying NOT NULL,
    mqtt_broker_port integer DEFAULT 1883 NOT NULL,
    mqtt_username character varying(100) DEFAULT 'xuheng'::character varying NOT NULL,
    mqtt_password character varying(255) DEFAULT 'xuheng8888!'::character varying NOT NULL,
    device_name character varying(100) DEFAULT 'EMS_N2'::character varying,
    product_key character varying(50) DEFAULT 'ems'::character varying,
    status character varying(20) DEFAULT 'online'::character varying NOT NULL,
    last_seen_at timestamp with time zone,
    commissioned_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    name character varying(200),
    address text,
    contracted_demand_kw real,
    ems_health jsonb DEFAULT '{}'::jsonb,
    ems_health_at timestamp with time zone,
    CONSTRAINT gateways_status_check CHECK (((status)::text = ANY ((ARRAY['online'::character varying, 'offline'::character varying, 'decommissioned'::character varying])::text[])))
);


--
-- Name: TABLE gateways; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.gateways IS 'M1 IoT Hub: EMS gateway registry. Each row = one MQTT connection to broker.';


--
-- Name: COLUMN gateways.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gateways.status IS 'online = heartbeat within 90s, offline = missed 3 heartbeats, decommissioned = removed.';


--
-- Name: offline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offline_events (
    id integer NOT NULL,
    asset_id character varying(200) NOT NULL,
    org_id character varying(50) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    cause character varying(50) DEFAULT 'unknown'::character varying,
    backfill boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: offline_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.offline_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: offline_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.offline_events_id_seq OWNED BY public.offline_events.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    org_id character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    plan_tier character varying(20) DEFAULT 'standard'::character varying NOT NULL,
    timezone character varying(50) DEFAULT 'America/Sao_Paulo'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: parser_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parser_rules (
    id integer NOT NULL,
    org_id character varying(50) NOT NULL,
    manufacturer character varying(100),
    model_version character varying(100),
    mapping_rule jsonb NOT NULL,
    unit_conversions jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: parser_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parser_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parser_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parser_rules_id_seq OWNED BY public.parser_rules.id;


--
-- Name: pld_horario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pld_horario (
    mes_referencia integer NOT NULL,
    dia smallint NOT NULL,
    hora smallint NOT NULL,
    submercado character varying(10) NOT NULL,
    pld_hora numeric(10,2) NOT NULL
);


--
-- Name: revenue_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_daily (
    id integer NOT NULL,
    asset_id character varying(200) NOT NULL,
    date date NOT NULL,
    pv_energy_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    grid_import_kwh numeric(10,3),
    bat_discharged_kwh numeric(10,3),
    revenue_reais numeric(12,2),
    cost_reais numeric(12,2),
    profit_reais numeric(12,2),
    vpp_arbitrage_profit_reais numeric(12,2),
    client_savings_reais numeric(12,2),
    actual_self_consumption_pct numeric(5,2),
    tariff_schedule_id integer,
    calculated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    baseline_cost_reais numeric(10,2),
    actual_cost_reais numeric(10,2),
    best_tou_cost_reais numeric(10,2),
    self_sufficiency_pct real,
    sc_savings_reais numeric(10,2),
    tou_savings_reais numeric(10,2),
    ps_savings_reais numeric(10,2),
    ps_avoided_peak_kva numeric(8,3),
    do_shed_confidence character varying(10),
    true_up_adjustment_reais numeric(10,2)
);


--
-- Name: COLUMN revenue_daily.ps_savings_reais; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_daily.ps_savings_reais IS 'Daily provisional PS savings (demand charge avoidance) in BRL.';


--
-- Name: COLUMN revenue_daily.ps_avoided_peak_kva; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_daily.ps_avoided_peak_kva IS 'Daily avoided peak demand in kVA (counterfactual - contracted).';


--
-- Name: COLUMN revenue_daily.do_shed_confidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_daily.do_shed_confidence IS 'high = full telemetry available; low = DO trigger detected but post-shed telemetry missing (backfill pending).';


--
-- Name: COLUMN revenue_daily.true_up_adjustment_reais; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.revenue_daily.true_up_adjustment_reais IS 'Monthly true-up adjustment. Written by MonthlyTrueUpJob on 1st of month. Never modifies past daily rows.';


--
-- Name: revenue_daily_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.revenue_daily_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: revenue_daily_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.revenue_daily_id_seq OWNED BY public.revenue_daily.id;


--
-- Name: tariff_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_schedules (
    id integer NOT NULL,
    org_id character varying(50) NOT NULL,
    schedule_name character varying(100) NOT NULL,
    peak_start time without time zone NOT NULL,
    peak_end time without time zone NOT NULL,
    peak_rate numeric(8,4) NOT NULL,
    offpeak_rate numeric(8,4) NOT NULL,
    feed_in_rate numeric(8,4) NOT NULL,
    intermediate_rate numeric(8,4),
    intermediate_start time without time zone,
    intermediate_end time without time zone,
    disco character varying(50),
    currency character varying(3) DEFAULT 'BRL'::character varying NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    demand_charge_rate_per_kva numeric(8,4),
    billing_power_factor numeric(3,2) DEFAULT 0.92
);


--
-- Name: COLUMN tariff_schedules.demand_charge_rate_per_kva; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_schedules.demand_charge_rate_per_kva IS 'Monthly demand charge rate in R$/kVA. Null = no demand charge billing.';


--
-- Name: COLUMN tariff_schedules.billing_power_factor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tariff_schedules.billing_power_factor IS 'Commercial billing power factor per utility contract (default 0.92 per ANEEL).';


--
-- Name: tariff_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_schedules_id_seq OWNED BY public.tariff_schedules.id;


--
-- Name: telemetry_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_history (
    id bigint NOT NULL,
    asset_id character varying(200) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    battery_soc numeric(5,2),
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    bat_work_status character varying(20),
    grid_import_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    battery_soh real,
    battery_voltage real,
    battery_current real,
    battery_temperature real,
    do0_active boolean,
    do1_active boolean,
    telemetry_extra jsonb,
    flload_power numeric(8,3),
    inverter_temp numeric(5,2),
    pv_daily_energy_kwh numeric(10,3),
    max_charge_current numeric(8,3),
    max_discharge_current numeric(8,3),
    daily_charge_kwh numeric(10,3),
    daily_discharge_kwh numeric(10,3)
)
PARTITION BY RANGE (recorded_at);


--
-- Name: COLUMN telemetry_history.do0_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.do0_active IS 'DO0 relay state: true = closed (load shed active). NULL when dido message not received.';


--
-- Name: COLUMN telemetry_history.do1_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.do1_active IS 'DO1 relay state: true = closed (load shed active). NULL when dido message not received.';


--
-- Name: COLUMN telemetry_history.telemetry_extra; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.telemetry_extra IS 'JSONB: per-phase detail from meter/grid/pv/load/flload Lists. Queried for diagnostics only.';


--
-- Name: COLUMN telemetry_history.flload_power; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.flload_power IS 'Home total load power (W). From flloadList.flload_totalPower.';


--
-- Name: COLUMN telemetry_history.max_charge_current; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.max_charge_current IS 'BMS max charge current (A). Used by ScheduleTranslator validation.';


--
-- Name: COLUMN telemetry_history.max_discharge_current; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.telemetry_history.max_discharge_current IS 'BMS max discharge current (A). Used by ScheduleTranslator validation.';


--
-- Name: telemetry_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telemetry_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telemetry_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telemetry_history_id_seq OWNED BY public.telemetry_history.id;


--
-- Name: telemetry_history_2026_02; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_history_2026_02 (
    id bigint DEFAULT nextval('public.telemetry_history_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    battery_soc numeric(5,2),
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    bat_work_status character varying(20),
    grid_import_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    battery_soh real,
    battery_voltage real,
    battery_current real,
    battery_temperature real,
    do0_active boolean,
    do1_active boolean,
    telemetry_extra jsonb,
    flload_power numeric(8,3),
    inverter_temp numeric(5,2),
    pv_daily_energy_kwh numeric(10,3),
    max_charge_current numeric(8,3),
    max_discharge_current numeric(8,3),
    daily_charge_kwh numeric(10,3),
    daily_discharge_kwh numeric(10,3)
);


--
-- Name: telemetry_history_2026_03; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_history_2026_03 (
    id bigint DEFAULT nextval('public.telemetry_history_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    battery_soc numeric(5,2),
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    bat_work_status character varying(20),
    grid_import_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    battery_soh real,
    battery_voltage real,
    battery_current real,
    battery_temperature real,
    do0_active boolean,
    do1_active boolean,
    telemetry_extra jsonb,
    flload_power numeric(8,3),
    inverter_temp numeric(5,2),
    pv_daily_energy_kwh numeric(10,3),
    max_charge_current numeric(8,3),
    max_discharge_current numeric(8,3),
    daily_charge_kwh numeric(10,3),
    daily_discharge_kwh numeric(10,3)
);


--
-- Name: telemetry_history_2026_04; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_history_2026_04 (
    id bigint DEFAULT nextval('public.telemetry_history_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    battery_soc numeric(5,2),
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    bat_work_status character varying(20),
    grid_import_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    battery_soh real,
    battery_voltage real,
    battery_current real,
    battery_temperature real,
    do0_active boolean,
    do1_active boolean,
    telemetry_extra jsonb,
    flload_power numeric(8,3),
    inverter_temp numeric(5,2),
    pv_daily_energy_kwh numeric(10,3),
    max_charge_current numeric(8,3),
    max_discharge_current numeric(8,3),
    daily_charge_kwh numeric(10,3),
    daily_discharge_kwh numeric(10,3)
);


--
-- Name: telemetry_history_default; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_history_default (
    id bigint DEFAULT nextval('public.telemetry_history_id_seq'::regclass) NOT NULL,
    asset_id character varying(200) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    battery_soc numeric(5,2),
    pv_power numeric(8,3),
    battery_power numeric(8,3),
    grid_power_kw numeric(8,3),
    load_power numeric(8,3),
    bat_work_status character varying(20),
    grid_import_kwh numeric(10,3),
    grid_export_kwh numeric(10,3),
    battery_soh real,
    battery_voltage real,
    battery_current real,
    battery_temperature real,
    do0_active boolean,
    do1_active boolean,
    telemetry_extra jsonb,
    flload_power numeric(8,3),
    inverter_temp numeric(5,2),
    pv_daily_energy_kwh numeric(10,3),
    max_charge_current numeric(8,3),
    max_discharge_current numeric(8,3),
    daily_charge_kwh numeric(10,3),
    daily_discharge_kwh numeric(10,3)
);


--
-- Name: trade_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trade_schedules (
    id integer NOT NULL,
    asset_id character varying(200) NOT NULL,
    org_id character varying(50) NOT NULL,
    planned_time timestamp with time zone NOT NULL,
    action character varying(10) NOT NULL,
    expected_volume_kwh numeric(8,2) NOT NULL,
    target_pld_price numeric(10,2),
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    target_mode character varying(50),
    CONSTRAINT trade_schedules_action_check CHECK (((action)::text = ANY ((ARRAY['charge'::character varying, 'discharge'::character varying, 'idle'::character varying])::text[])))
);


--
-- Name: trade_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trade_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trade_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trade_schedules_id_seq OWNED BY public.trade_schedules.id;


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id integer NOT NULL,
    asset_id character varying(200) NOT NULL,
    traded_at timestamp with time zone NOT NULL,
    trade_type character varying(20) NOT NULL,
    energy_kwh numeric(10,3) NOT NULL,
    price_per_kwh numeric(8,4) NOT NULL,
    total_reais numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trades_id_seq OWNED BY public.trades.id;


--
-- Name: user_org_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_org_roles (
    user_id character varying(50) NOT NULL,
    org_id character varying(50) NOT NULL,
    role character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id character varying(50) NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(200),
    hashed_password character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vpp_strategies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vpp_strategies (
    id integer NOT NULL,
    org_id character varying(50) NOT NULL,
    strategy_name character varying(100) NOT NULL,
    target_mode character varying(50) NOT NULL,
    min_soc numeric(5,2) DEFAULT 20 NOT NULL,
    max_soc numeric(5,2) DEFAULT 95 NOT NULL,
    charge_window_start time without time zone,
    charge_window_end time without time zone,
    discharge_window_start time without time zone,
    max_charge_rate_kw numeric(6,2),
    target_self_consumption_pct numeric(5,2) DEFAULT 80.0,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vpp_strategies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vpp_strategies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vpp_strategies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vpp_strategies_id_seq OWNED BY public.vpp_strategies.id;


--
-- Name: weather_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weather_cache (
    id integer NOT NULL,
    location character varying(100) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    temperature numeric(5,2),
    irradiance numeric(8,2),
    cloud_cover numeric(5,2),
    source character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: weather_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.weather_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: weather_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.weather_cache_id_seq OWNED BY public.weather_cache.id;


--
-- Name: asset_5min_metrics_20260306; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260306 FOR VALUES FROM ('2026-03-06 11:00:00+08') TO ('2026-03-07 11:00:00+08');


--
-- Name: asset_5min_metrics_20260307; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260307 FOR VALUES FROM ('2026-03-07 11:00:00+08') TO ('2026-03-08 11:00:00+08');


--
-- Name: asset_5min_metrics_20260308; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260308 FOR VALUES FROM ('2026-03-08 11:00:00+08') TO ('2026-03-09 11:00:00+08');


--
-- Name: asset_5min_metrics_20260309; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260309 FOR VALUES FROM ('2026-03-09 11:00:00+08') TO ('2026-03-10 11:00:00+08');


--
-- Name: asset_5min_metrics_20260310; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260310 FOR VALUES FROM ('2026-03-10 11:00:00+08') TO ('2026-03-11 11:00:00+08');


--
-- Name: asset_5min_metrics_20260311; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260311 FOR VALUES FROM ('2026-03-11 11:00:00+08') TO ('2026-03-12 11:00:00+08');


--
-- Name: asset_5min_metrics_20260312; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260312 FOR VALUES FROM ('2026-03-12 11:00:00+08') TO ('2026-03-13 11:00:00+08');


--
-- Name: asset_5min_metrics_20260313; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260313 FOR VALUES FROM ('2026-03-13 11:00:00+08') TO ('2026-03-14 11:00:00+08');


--
-- Name: asset_5min_metrics_20260314; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260314 FOR VALUES FROM ('2026-03-14 11:00:00+08') TO ('2026-03-15 11:00:00+08');


--
-- Name: asset_5min_metrics_20260315; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260315 FOR VALUES FROM ('2026-03-15 11:00:00+08') TO ('2026-03-16 11:00:00+08');


--
-- Name: asset_5min_metrics_20260316; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260316 FOR VALUES FROM ('2026-03-16 11:00:00+08') TO ('2026-03-17 11:00:00+08');


--
-- Name: asset_5min_metrics_20260317; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260317 FOR VALUES FROM ('2026-03-17 11:00:00+08') TO ('2026-03-18 11:00:00+08');


--
-- Name: asset_5min_metrics_20260318; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260318 FOR VALUES FROM ('2026-03-18 11:00:00+08') TO ('2026-03-19 11:00:00+08');


--
-- Name: asset_5min_metrics_20260319; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260319 FOR VALUES FROM ('2026-03-19 11:00:00+08') TO ('2026-03-20 11:00:00+08');


--
-- Name: asset_5min_metrics_20260320; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260320 FOR VALUES FROM ('2026-03-20 11:00:00+08') TO ('2026-03-21 11:00:00+08');


--
-- Name: asset_5min_metrics_20260321; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260321 FOR VALUES FROM ('2026-03-21 11:00:00+08') TO ('2026-03-22 11:00:00+08');


--
-- Name: asset_5min_metrics_20260322; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260322 FOR VALUES FROM ('2026-03-22 11:00:00+08') TO ('2026-03-23 11:00:00+08');


--
-- Name: asset_5min_metrics_20260323; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260323 FOR VALUES FROM ('2026-03-23 11:00:00+08') TO ('2026-03-24 11:00:00+08');


--
-- Name: asset_5min_metrics_20260324; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260324 FOR VALUES FROM ('2026-03-24 11:00:00+08') TO ('2026-03-25 11:00:00+08');


--
-- Name: asset_5min_metrics_20260325; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260325 FOR VALUES FROM ('2026-03-25 11:00:00+08') TO ('2026-03-26 11:00:00+08');


--
-- Name: asset_5min_metrics_20260326; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260326 FOR VALUES FROM ('2026-03-26 11:00:00+08') TO ('2026-03-27 11:00:00+08');


--
-- Name: asset_5min_metrics_20260327; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260327 FOR VALUES FROM ('2026-03-27 11:00:00+08') TO ('2026-03-28 11:00:00+08');


--
-- Name: asset_5min_metrics_20260328; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260328 FOR VALUES FROM ('2026-03-28 11:00:00+08') TO ('2026-03-29 11:00:00+08');


--
-- Name: asset_5min_metrics_20260329; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260329 FOR VALUES FROM ('2026-03-29 11:00:00+08') TO ('2026-03-30 11:00:00+08');


--
-- Name: asset_5min_metrics_20260330; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260330 FOR VALUES FROM ('2026-03-30 11:00:00+08') TO ('2026-03-31 11:00:00+08');


--
-- Name: asset_5min_metrics_20260331; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260331 FOR VALUES FROM ('2026-03-31 11:00:00+08') TO ('2026-04-01 11:00:00+08');


--
-- Name: asset_5min_metrics_20260401; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260401 FOR VALUES FROM ('2026-04-01 11:00:00+08') TO ('2026-04-02 11:00:00+08');


--
-- Name: asset_5min_metrics_20260402; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260402 FOR VALUES FROM ('2026-04-02 11:00:00+08') TO ('2026-04-03 11:00:00+08');


--
-- Name: asset_5min_metrics_20260403; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260403 FOR VALUES FROM ('2026-04-03 11:00:00+08') TO ('2026-04-04 11:00:00+08');


--
-- Name: asset_5min_metrics_20260404; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260404 FOR VALUES FROM ('2026-04-04 11:00:00+08') TO ('2026-04-05 11:00:00+08');


--
-- Name: asset_5min_metrics_20260405; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260405 FOR VALUES FROM ('2026-04-05 11:00:00+08') TO ('2026-04-06 11:00:00+08');


--
-- Name: asset_5min_metrics_20260406; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ATTACH PARTITION public.asset_5min_metrics_20260406 FOR VALUES FROM ('2026-04-06 11:00:00+08') TO ('2026-04-07 11:00:00+08');


--
-- Name: telemetry_history_2026_02; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history ATTACH PARTITION public.telemetry_history_2026_02 FOR VALUES FROM ('2026-02-01 00:00:00+08') TO ('2026-03-01 00:00:00+08');


--
-- Name: telemetry_history_2026_03; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history ATTACH PARTITION public.telemetry_history_2026_03 FOR VALUES FROM ('2026-03-01 00:00:00+08') TO ('2026-04-01 00:00:00+08');


--
-- Name: telemetry_history_2026_04; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history ATTACH PARTITION public.telemetry_history_2026_04 FOR VALUES FROM ('2026-04-01 00:00:00+08') TO ('2026-05-01 00:00:00+08');


--
-- Name: telemetry_history_default; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history ATTACH PARTITION public.telemetry_history_default DEFAULT;


--
-- Name: algorithm_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.algorithm_metrics ALTER COLUMN id SET DEFAULT nextval('public.algorithm_metrics_id_seq'::regclass);


--
-- Name: asset_5min_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_5min_metrics ALTER COLUMN id SET DEFAULT nextval('public.asset_5min_metrics_id_seq'::regclass);


--
-- Name: asset_hourly_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_hourly_metrics ALTER COLUMN id SET DEFAULT nextval('public.asset_hourly_metrics_id_seq'::regclass);


--
-- Name: backfill_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backfill_requests ALTER COLUMN id SET DEFAULT nextval('public.backfill_requests_id_seq'::regclass);


--
-- Name: daily_uptime_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_uptime_snapshots ALTER COLUMN id SET DEFAULT nextval('public.daily_uptime_snapshots_id_seq'::regclass);


--
-- Name: device_command_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_command_logs ALTER COLUMN id SET DEFAULT nextval('public.device_command_logs_id_seq'::regclass);


--
-- Name: dispatch_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_commands ALTER COLUMN id SET DEFAULT nextval('public.dispatch_commands_id_seq'::regclass);


--
-- Name: dispatch_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_records ALTER COLUMN id SET DEFAULT nextval('public.dispatch_records_id_seq'::regclass);


--
-- Name: feature_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags ALTER COLUMN id SET DEFAULT nextval('public.feature_flags_id_seq'::regclass);


--
-- Name: offline_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_events ALTER COLUMN id SET DEFAULT nextval('public.offline_events_id_seq'::regclass);


--
-- Name: parser_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parser_rules ALTER COLUMN id SET DEFAULT nextval('public.parser_rules_id_seq'::regclass);


--
-- Name: revenue_daily id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_daily ALTER COLUMN id SET DEFAULT nextval('public.revenue_daily_id_seq'::regclass);


--
-- Name: tariff_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_schedules ALTER COLUMN id SET DEFAULT nextval('public.tariff_schedules_id_seq'::regclass);


--
-- Name: telemetry_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history ALTER COLUMN id SET DEFAULT nextval('public.telemetry_history_id_seq'::regclass);


--
-- Name: trade_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_schedules ALTER COLUMN id SET DEFAULT nextval('public.trade_schedules_id_seq'::regclass);


--
-- Name: trades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades ALTER COLUMN id SET DEFAULT nextval('public.trades_id_seq'::regclass);


--
-- Name: vpp_strategies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vpp_strategies ALTER COLUMN id SET DEFAULT nextval('public.vpp_strategies_id_seq'::regclass);


--
-- Name: weather_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_cache ALTER COLUMN id SET DEFAULT nextval('public.weather_cache_id_seq'::regclass);


--
-- Name: algorithm_metrics algorithm_metrics_org_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.algorithm_metrics
    ADD CONSTRAINT algorithm_metrics_org_id_date_key UNIQUE (org_id, date);


--
-- Name: algorithm_metrics algorithm_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.algorithm_metrics
    ADD CONSTRAINT algorithm_metrics_pkey PRIMARY KEY (id);


--
-- Name: asset_hourly_metrics asset_hourly_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_hourly_metrics
    ADD CONSTRAINT asset_hourly_metrics_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (asset_id);


--
-- Name: backfill_requests backfill_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backfill_requests
    ADD CONSTRAINT backfill_requests_pkey PRIMARY KEY (id);


--
-- Name: daily_uptime_snapshots daily_uptime_snapshots_org_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_uptime_snapshots
    ADD CONSTRAINT daily_uptime_snapshots_org_id_date_key UNIQUE (org_id, date);


--
-- Name: daily_uptime_snapshots daily_uptime_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_uptime_snapshots
    ADD CONSTRAINT daily_uptime_snapshots_pkey PRIMARY KEY (id);


--
-- Name: data_dictionary data_dictionary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_dictionary
    ADD CONSTRAINT data_dictionary_pkey PRIMARY KEY (field_id);


--
-- Name: device_command_logs device_command_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_command_logs
    ADD CONSTRAINT device_command_logs_pkey PRIMARY KEY (id);


--
-- Name: device_state device_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_state
    ADD CONSTRAINT device_state_pkey PRIMARY KEY (asset_id);


--
-- Name: dispatch_commands dispatch_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_commands
    ADD CONSTRAINT dispatch_commands_pkey PRIMARY KEY (id);


--
-- Name: dispatch_records dispatch_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_records
    ADD CONSTRAINT dispatch_records_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);


--
-- Name: gateways gateways_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateways
    ADD CONSTRAINT gateways_pkey PRIMARY KEY (gateway_id);


--
-- Name: offline_events offline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_events
    ADD CONSTRAINT offline_events_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (org_id);


--
-- Name: parser_rules parser_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parser_rules
    ADD CONSTRAINT parser_rules_pkey PRIMARY KEY (id);


--
-- Name: pld_horario pld_horario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pld_horario
    ADD CONSTRAINT pld_horario_pkey PRIMARY KEY (mes_referencia, dia, hora, submercado);


--
-- Name: revenue_daily revenue_daily_asset_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_daily
    ADD CONSTRAINT revenue_daily_asset_id_date_key UNIQUE (asset_id, date);


--
-- Name: revenue_daily revenue_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_daily
    ADD CONSTRAINT revenue_daily_pkey PRIMARY KEY (id);


--
-- Name: tariff_schedules tariff_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_schedules
    ADD CONSTRAINT tariff_schedules_pkey PRIMARY KEY (id);


--
-- Name: telemetry_history telemetry_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history
    ADD CONSTRAINT telemetry_history_pkey PRIMARY KEY (id, recorded_at);


--
-- Name: telemetry_history_2026_02 telemetry_history_2026_02_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history_2026_02
    ADD CONSTRAINT telemetry_history_2026_02_pkey PRIMARY KEY (id, recorded_at);


--
-- Name: telemetry_history_2026_03 telemetry_history_2026_03_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history_2026_03
    ADD CONSTRAINT telemetry_history_2026_03_pkey PRIMARY KEY (id, recorded_at);


--
-- Name: telemetry_history_2026_04 telemetry_history_2026_04_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history_2026_04
    ADD CONSTRAINT telemetry_history_2026_04_pkey PRIMARY KEY (id, recorded_at);


--
-- Name: telemetry_history_default telemetry_history_default_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_history_default
    ADD CONSTRAINT telemetry_history_default_pkey PRIMARY KEY (id, recorded_at);


--
-- Name: trade_schedules trade_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_schedules
    ADD CONSTRAINT trade_schedules_pkey PRIMARY KEY (id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: asset_hourly_metrics uq_asset_hourly; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_hourly_metrics
    ADD CONSTRAINT uq_asset_hourly UNIQUE (asset_id, hour_timestamp);


--
-- Name: user_org_roles user_org_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_roles
    ADD CONSTRAINT user_org_roles_pkey PRIMARY KEY (user_id, org_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: vpp_strategies vpp_strategies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vpp_strategies
    ADD CONSTRAINT vpp_strategies_pkey PRIMARY KEY (id);


--
-- Name: weather_cache weather_cache_location_recorded_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_cache
    ADD CONSTRAINT weather_cache_location_recorded_at_key UNIQUE (location, recorded_at);


--
-- Name: weather_cache weather_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weather_cache
    ADD CONSTRAINT weather_cache_pkey PRIMARY KEY (id);


--
-- Name: idx_5min_asset_window; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_5min_asset_window ON ONLY public.asset_5min_metrics USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260306_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260306_asset_id_window_start_idx ON public.asset_5min_metrics_20260306 USING btree (asset_id, window_start);


--
-- Name: idx_5min_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_5min_window ON ONLY public.asset_5min_metrics USING btree (window_start);


--
-- Name: asset_5min_metrics_20260306_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260306_window_start_idx ON public.asset_5min_metrics_20260306 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260307_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260307_asset_id_window_start_idx ON public.asset_5min_metrics_20260307 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260307_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260307_window_start_idx ON public.asset_5min_metrics_20260307 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260308_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260308_asset_id_window_start_idx ON public.asset_5min_metrics_20260308 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260308_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260308_window_start_idx ON public.asset_5min_metrics_20260308 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260309_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260309_asset_id_window_start_idx ON public.asset_5min_metrics_20260309 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260309_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260309_window_start_idx ON public.asset_5min_metrics_20260309 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260310_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260310_asset_id_window_start_idx ON public.asset_5min_metrics_20260310 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260310_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260310_window_start_idx ON public.asset_5min_metrics_20260310 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260311_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260311_asset_id_window_start_idx ON public.asset_5min_metrics_20260311 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260311_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260311_window_start_idx ON public.asset_5min_metrics_20260311 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260312_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260312_asset_id_window_start_idx ON public.asset_5min_metrics_20260312 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260312_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260312_window_start_idx ON public.asset_5min_metrics_20260312 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260313_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260313_asset_id_window_start_idx ON public.asset_5min_metrics_20260313 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260313_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260313_window_start_idx ON public.asset_5min_metrics_20260313 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260314_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260314_asset_id_window_start_idx ON public.asset_5min_metrics_20260314 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260314_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260314_window_start_idx ON public.asset_5min_metrics_20260314 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260315_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260315_asset_id_window_start_idx ON public.asset_5min_metrics_20260315 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260315_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260315_window_start_idx ON public.asset_5min_metrics_20260315 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260316_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260316_asset_id_window_start_idx ON public.asset_5min_metrics_20260316 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260316_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260316_window_start_idx ON public.asset_5min_metrics_20260316 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260317_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260317_asset_id_window_start_idx ON public.asset_5min_metrics_20260317 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260317_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260317_window_start_idx ON public.asset_5min_metrics_20260317 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260318_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260318_asset_id_window_start_idx ON public.asset_5min_metrics_20260318 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260318_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260318_window_start_idx ON public.asset_5min_metrics_20260318 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260319_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260319_asset_id_window_start_idx ON public.asset_5min_metrics_20260319 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260319_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260319_window_start_idx ON public.asset_5min_metrics_20260319 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260320_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260320_asset_id_window_start_idx ON public.asset_5min_metrics_20260320 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260320_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260320_window_start_idx ON public.asset_5min_metrics_20260320 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260321_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260321_asset_id_window_start_idx ON public.asset_5min_metrics_20260321 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260321_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260321_window_start_idx ON public.asset_5min_metrics_20260321 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260322_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260322_asset_id_window_start_idx ON public.asset_5min_metrics_20260322 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260322_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260322_window_start_idx ON public.asset_5min_metrics_20260322 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260323_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260323_asset_id_window_start_idx ON public.asset_5min_metrics_20260323 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260323_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260323_window_start_idx ON public.asset_5min_metrics_20260323 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260324_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260324_asset_id_window_start_idx ON public.asset_5min_metrics_20260324 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260324_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260324_window_start_idx ON public.asset_5min_metrics_20260324 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260325_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260325_asset_id_window_start_idx ON public.asset_5min_metrics_20260325 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260325_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260325_window_start_idx ON public.asset_5min_metrics_20260325 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260326_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260326_asset_id_window_start_idx ON public.asset_5min_metrics_20260326 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260326_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260326_window_start_idx ON public.asset_5min_metrics_20260326 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260327_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260327_asset_id_window_start_idx ON public.asset_5min_metrics_20260327 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260327_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260327_window_start_idx ON public.asset_5min_metrics_20260327 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260328_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260328_asset_id_window_start_idx ON public.asset_5min_metrics_20260328 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260328_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260328_window_start_idx ON public.asset_5min_metrics_20260328 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260329_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260329_asset_id_window_start_idx ON public.asset_5min_metrics_20260329 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260329_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260329_window_start_idx ON public.asset_5min_metrics_20260329 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260330_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260330_asset_id_window_start_idx ON public.asset_5min_metrics_20260330 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260330_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260330_window_start_idx ON public.asset_5min_metrics_20260330 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260331_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260331_asset_id_window_start_idx ON public.asset_5min_metrics_20260331 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260331_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260331_window_start_idx ON public.asset_5min_metrics_20260331 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260401_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260401_asset_id_window_start_idx ON public.asset_5min_metrics_20260401 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260401_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260401_window_start_idx ON public.asset_5min_metrics_20260401 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260402_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260402_asset_id_window_start_idx ON public.asset_5min_metrics_20260402 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260402_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260402_window_start_idx ON public.asset_5min_metrics_20260402 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260403_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260403_asset_id_window_start_idx ON public.asset_5min_metrics_20260403 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260403_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260403_window_start_idx ON public.asset_5min_metrics_20260403 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260404_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260404_asset_id_window_start_idx ON public.asset_5min_metrics_20260404 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260404_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260404_window_start_idx ON public.asset_5min_metrics_20260404 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260405_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260405_asset_id_window_start_idx ON public.asset_5min_metrics_20260405 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260405_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260405_window_start_idx ON public.asset_5min_metrics_20260405 USING btree (window_start);


--
-- Name: asset_5min_metrics_20260406_asset_id_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX asset_5min_metrics_20260406_asset_id_window_start_idx ON public.asset_5min_metrics_20260406 USING btree (asset_id, window_start);


--
-- Name: asset_5min_metrics_20260406_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_5min_metrics_20260406_window_start_idx ON public.asset_5min_metrics_20260406 USING btree (window_start);


--
-- Name: idx_asset_hourly_asset_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_hourly_asset_hour ON public.asset_hourly_metrics USING btree (asset_id, hour_timestamp DESC);


--
-- Name: idx_asset_hourly_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_hourly_hour ON public.asset_hourly_metrics USING btree (hour_timestamp DESC);


--
-- Name: idx_assets_gateway; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_gateway ON public.assets USING btree (gateway_id);


--
-- Name: idx_assets_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_org ON public.assets USING btree (org_id);


--
-- Name: idx_assets_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_type ON public.assets USING btree (asset_type);


--
-- Name: idx_backfill_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backfill_active ON public.backfill_requests USING btree (created_at) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying])::text[]));


--
-- Name: idx_cmd_logs_gateway; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmd_logs_gateway ON public.device_command_logs USING btree (gateway_id, created_at DESC);


--
-- Name: idx_cmd_logs_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmd_logs_message ON public.device_command_logs USING btree (gateway_id, message_id);


--
-- Name: idx_cmd_logs_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmd_logs_pending ON public.device_command_logs USING btree (result) WHERE ((result)::text = 'pending'::text);


--
-- Name: idx_dcl_accepted_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dcl_accepted_set ON public.device_command_logs USING btree (created_at) WHERE (((result)::text = 'accepted'::text) AND ((command_type)::text = 'set'::text));


--
-- Name: idx_dcl_dispatched_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dcl_dispatched_set ON public.device_command_logs USING btree (created_at) WHERE (((result)::text = 'dispatched'::text) AND ((command_type)::text = 'set'::text));


--
-- Name: idx_dcl_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dcl_batch ON public.device_command_logs USING btree (batch_id) WHERE (batch_id IS NOT NULL);


--
-- Name: idx_dispatch_asset_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_asset_time ON public.dispatch_records USING btree (asset_id, dispatched_at DESC);


--
-- Name: idx_dispatch_commands_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_commands_org ON public.dispatch_commands USING btree (org_id);


--
-- Name: idx_dispatch_commands_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_commands_status ON public.dispatch_commands USING btree (status, dispatched_at);


--
-- Name: idx_dispatch_commands_status_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dispatch_commands_status_org ON public.dispatch_commands USING btree (org_id, status, dispatched_at DESC);


--
-- Name: idx_gateways_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gateways_org ON public.gateways USING btree (org_id);


--
-- Name: idx_gateways_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gateways_status ON public.gateways USING btree (status);


--
-- Name: idx_offline_events_asset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offline_events_asset ON public.offline_events USING btree (asset_id, started_at DESC);


--
-- Name: idx_revenue_asset_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_asset_date ON public.revenue_daily USING btree (asset_id, date DESC);


--
-- Name: idx_telemetry_asset_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_asset_time ON ONLY public.telemetry_history USING btree (asset_id, recorded_at DESC);


--
-- Name: idx_telemetry_unique_asset_time; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_telemetry_unique_asset_time ON ONLY public.telemetry_history USING btree (asset_id, recorded_at);


--
-- Name: idx_telemetry_unique_2026_02; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_telemetry_unique_2026_02 ON public.telemetry_history_2026_02 USING btree (asset_id, recorded_at);


--
-- Name: idx_telemetry_unique_2026_03; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_telemetry_unique_2026_03 ON public.telemetry_history_2026_03 USING btree (asset_id, recorded_at);


--
-- Name: idx_telemetry_unique_2026_04; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_telemetry_unique_2026_04 ON public.telemetry_history_2026_04 USING btree (asset_id, recorded_at);


--
-- Name: idx_telemetry_unique_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_telemetry_unique_default ON public.telemetry_history_default USING btree (asset_id, recorded_at);


--
-- Name: idx_trade_schedules_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trade_schedules_status ON public.trade_schedules USING btree (status, planned_time);


--
-- Name: idx_trades_asset_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trades_asset_time ON public.trades USING btree (asset_id, traded_at DESC);


--
-- Name: idx_uptime_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_uptime_org_date ON public.daily_uptime_snapshots USING btree (org_id, date DESC);


--
-- Name: idx_weather_location_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weather_location_time ON public.weather_cache USING btree (location, recorded_at DESC);


--
-- Name: telemetry_history_2026_02_asset_id_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_history_2026_02_asset_id_recorded_at_idx ON public.telemetry_history_2026_02 USING btree (asset_id, recorded_at DESC);


--
-- Name: telemetry_history_2026_03_asset_id_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_history_2026_03_asset_id_recorded_at_idx ON public.telemetry_history_2026_03 USING btree (asset_id, recorded_at DESC);


--
-- Name: telemetry_history_2026_04_asset_id_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_history_2026_04_asset_id_recorded_at_idx ON public.telemetry_history_2026_04 USING btree (asset_id, recorded_at DESC);


--
-- Name: telemetry_history_default_asset_id_recorded_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_history_default_asset_id_recorded_at_idx ON public.telemetry_history_default USING btree (asset_id, recorded_at DESC);


--
-- Name: uq_feature_flags_name_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_feature_flags_name_org ON public.feature_flags USING btree (flag_name, COALESCE(org_id, ''::character varying));


--
-- Name: asset_5min_metrics_20260306_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260306_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260306_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260306_window_start_idx;


--
-- Name: asset_5min_metrics_20260307_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260307_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260307_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260307_window_start_idx;


--
-- Name: asset_5min_metrics_20260308_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260308_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260308_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260308_window_start_idx;


--
-- Name: asset_5min_metrics_20260309_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260309_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260309_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260309_window_start_idx;


--
-- Name: asset_5min_metrics_20260310_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260310_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260310_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260310_window_start_idx;


--
-- Name: asset_5min_metrics_20260311_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260311_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260311_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260311_window_start_idx;


--
-- Name: asset_5min_metrics_20260312_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260312_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260312_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260312_window_start_idx;


--
-- Name: asset_5min_metrics_20260313_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260313_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260313_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260313_window_start_idx;


--
-- Name: asset_5min_metrics_20260314_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260314_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260314_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260314_window_start_idx;


--
-- Name: asset_5min_metrics_20260315_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260315_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260315_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260315_window_start_idx;


--
-- Name: asset_5min_metrics_20260316_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260316_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260316_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260316_window_start_idx;


--
-- Name: asset_5min_metrics_20260317_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260317_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260317_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260317_window_start_idx;


--
-- Name: asset_5min_metrics_20260318_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260318_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260318_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260318_window_start_idx;


--
-- Name: asset_5min_metrics_20260319_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260319_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260319_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260319_window_start_idx;


--
-- Name: asset_5min_metrics_20260320_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260320_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260320_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260320_window_start_idx;


--
-- Name: asset_5min_metrics_20260321_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260321_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260321_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260321_window_start_idx;


--
-- Name: asset_5min_metrics_20260322_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260322_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260322_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260322_window_start_idx;


--
-- Name: asset_5min_metrics_20260323_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260323_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260323_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260323_window_start_idx;


--
-- Name: asset_5min_metrics_20260324_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260324_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260324_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260324_window_start_idx;


--
-- Name: asset_5min_metrics_20260325_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260325_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260325_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260325_window_start_idx;


--
-- Name: asset_5min_metrics_20260326_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260326_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260326_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260326_window_start_idx;


--
-- Name: asset_5min_metrics_20260327_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260327_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260327_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260327_window_start_idx;


--
-- Name: asset_5min_metrics_20260328_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260328_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260328_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260328_window_start_idx;


--
-- Name: asset_5min_metrics_20260329_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260329_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260329_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260329_window_start_idx;


--
-- Name: asset_5min_metrics_20260330_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260330_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260330_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260330_window_start_idx;


--
-- Name: asset_5min_metrics_20260331_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260331_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260331_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260331_window_start_idx;


--
-- Name: asset_5min_metrics_20260401_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260401_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260401_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260401_window_start_idx;


--
-- Name: asset_5min_metrics_20260402_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260402_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260402_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260402_window_start_idx;


--
-- Name: asset_5min_metrics_20260403_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260403_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260403_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260403_window_start_idx;


--
-- Name: asset_5min_metrics_20260404_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260404_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260404_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260404_window_start_idx;


--
-- Name: asset_5min_metrics_20260405_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260405_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260405_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260405_window_start_idx;


--
-- Name: asset_5min_metrics_20260406_asset_id_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_asset_window ATTACH PARTITION public.asset_5min_metrics_20260406_asset_id_window_start_idx;


--
-- Name: asset_5min_metrics_20260406_window_start_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_5min_window ATTACH PARTITION public.asset_5min_metrics_20260406_window_start_idx;


--
-- Name: idx_telemetry_unique_2026_02; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_unique_asset_time ATTACH PARTITION public.idx_telemetry_unique_2026_02;


--
-- Name: idx_telemetry_unique_2026_03; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_unique_asset_time ATTACH PARTITION public.idx_telemetry_unique_2026_03;


--
-- Name: idx_telemetry_unique_2026_04; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_unique_asset_time ATTACH PARTITION public.idx_telemetry_unique_2026_04;


--
-- Name: idx_telemetry_unique_default; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_unique_asset_time ATTACH PARTITION public.idx_telemetry_unique_default;


--
-- Name: telemetry_history_2026_02_asset_id_recorded_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_asset_time ATTACH PARTITION public.telemetry_history_2026_02_asset_id_recorded_at_idx;


--
-- Name: telemetry_history_2026_02_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.telemetry_history_pkey ATTACH PARTITION public.telemetry_history_2026_02_pkey;


--
-- Name: telemetry_history_2026_03_asset_id_recorded_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_asset_time ATTACH PARTITION public.telemetry_history_2026_03_asset_id_recorded_at_idx;


--
-- Name: telemetry_history_2026_03_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.telemetry_history_pkey ATTACH PARTITION public.telemetry_history_2026_03_pkey;


--
-- Name: telemetry_history_2026_04_asset_id_recorded_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_asset_time ATTACH PARTITION public.telemetry_history_2026_04_asset_id_recorded_at_idx;


--
-- Name: telemetry_history_2026_04_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.telemetry_history_pkey ATTACH PARTITION public.telemetry_history_2026_04_pkey;


--
-- Name: telemetry_history_default_asset_id_recorded_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_telemetry_asset_time ATTACH PARTITION public.telemetry_history_default_asset_id_recorded_at_idx;


--
-- Name: telemetry_history_default_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.telemetry_history_pkey ATTACH PARTITION public.telemetry_history_default_pkey;


--
-- Name: asset_5min_metrics asset_5min_metrics_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.asset_5min_metrics
    ADD CONSTRAINT asset_5min_metrics_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: asset_hourly_metrics asset_hourly_metrics_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_hourly_metrics
    ADD CONSTRAINT asset_hourly_metrics_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: assets assets_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateways(gateway_id);


--
-- Name: assets assets_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: backfill_requests backfill_requests_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backfill_requests
    ADD CONSTRAINT backfill_requests_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateways(gateway_id);


--
-- Name: daily_uptime_snapshots daily_uptime_snapshots_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_uptime_snapshots
    ADD CONSTRAINT daily_uptime_snapshots_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: device_command_logs device_command_logs_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_command_logs
    ADD CONSTRAINT device_command_logs_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.gateways(gateway_id);


--
-- Name: device_state device_state_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_state
    ADD CONSTRAINT device_state_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id) ON DELETE CASCADE;


--
-- Name: dispatch_commands dispatch_commands_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_commands
    ADD CONSTRAINT dispatch_commands_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: dispatch_commands dispatch_commands_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_commands
    ADD CONSTRAINT dispatch_commands_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: dispatch_commands dispatch_commands_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_commands
    ADD CONSTRAINT dispatch_commands_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trade_schedules(id);


--
-- Name: dispatch_records dispatch_records_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_records
    ADD CONSTRAINT dispatch_records_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: feature_flags feature_flags_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: gateways gateways_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateways
    ADD CONSTRAINT gateways_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: offline_events offline_events_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_events
    ADD CONSTRAINT offline_events_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: offline_events offline_events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_events
    ADD CONSTRAINT offline_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: parser_rules parser_rules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parser_rules
    ADD CONSTRAINT parser_rules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: revenue_daily revenue_daily_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_daily
    ADD CONSTRAINT revenue_daily_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: revenue_daily revenue_daily_tariff_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_daily
    ADD CONSTRAINT revenue_daily_tariff_schedule_id_fkey FOREIGN KEY (tariff_schedule_id) REFERENCES public.tariff_schedules(id);


--
-- Name: tariff_schedules tariff_schedules_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_schedules
    ADD CONSTRAINT tariff_schedules_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: trade_schedules trade_schedules_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trade_schedules
    ADD CONSTRAINT trade_schedules_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: trades trades_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(asset_id);


--
-- Name: user_org_roles user_org_roles_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_roles
    ADD CONSTRAINT user_org_roles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE;


--
-- Name: user_org_roles user_org_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_org_roles
    ADD CONSTRAINT user_org_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: vpp_strategies vpp_strategies_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vpp_strategies
    ADD CONSTRAINT vpp_strategies_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(org_id);


--
-- Name: algorithm_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.algorithm_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_uptime_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_uptime_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: dispatch_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dispatch_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: gateways; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateways ENABLE ROW LEVEL SECURITY;

--
-- Name: offline_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offline_events ENABLE ROW LEVEL SECURITY;

--
-- Name: parser_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parser_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: algorithm_metrics rls_algorithm_metrics_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_algorithm_metrics_tenant ON public.algorithm_metrics USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: assets rls_assets_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_assets_tenant ON public.assets USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: dispatch_commands rls_dispatch_commands_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_dispatch_commands_tenant ON public.dispatch_commands USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: feature_flags rls_feature_flags_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_feature_flags_tenant ON public.feature_flags USING (((org_id IS NULL) OR ((org_id)::text = current_setting('app.current_org_id'::text, true))));


--
-- Name: gateways rls_gateways_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_gateways_tenant ON public.gateways USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: offline_events rls_offline_events_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_offline_events_tenant ON public.offline_events USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: parser_rules rls_parser_rules_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_parser_rules_tenant ON public.parser_rules USING (((org_id IS NULL) OR ((org_id)::text = current_setting('app.current_org_id'::text, true))));


--
-- Name: revenue_daily rls_revenue_daily_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_revenue_daily_admin ON public.revenue_daily FOR SELECT USING (((current_setting('app.current_org_id'::text, true) = ''::text) OR (current_setting('app.current_org_id'::text, true) IS NULL)));


--
-- Name: tariff_schedules rls_tariff_schedules_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_tariff_schedules_tenant ON public.tariff_schedules USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: trade_schedules rls_trade_schedules_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_trade_schedules_tenant ON public.trade_schedules USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: daily_uptime_snapshots rls_uptime_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_uptime_tenant ON public.daily_uptime_snapshots USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: vpp_strategies rls_vpp_strategies_tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_vpp_strategies_tenant ON public.vpp_strategies USING (((org_id)::text = current_setting('app.current_org_id'::text, true)));


--
-- Name: tariff_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tariff_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: trade_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trade_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: vpp_strategies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vpp_strategies ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


