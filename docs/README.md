# Trapline documentation

Trapline is a community ISP service-quality monitor. It runs quietly on a computer in your
home, checks your internet connection around the clock, and turns what it finds into
evidence-grade reports you can put in front of your internet provider: exact outage times,
measured speeds versus what you pay for, and a fault classification that separates "my WiFi
was broken" from "the ISP's network was down."

Start with **[Why Trapline exists](PURPOSE.md)** — the purpose of this project in plain
language.

## I just want to use it — the User Guide

Written for everyone; no networking background needed.

| Document | What it covers |
|---|---|
| [Getting started](user/getting-started.md) | What you need, how to install, first-run setup |
| [The Dashboard](user/dashboard.md) | Reading the main screen: status, tiles, charts, monitoring modes |
| [Reports](user/reports.md) | Exporting evidence and using it with your ISP |
| [Tools](user/tools.md) | "Is it me or the ISP, right now?" — the on-demand checks |
| [Data usage](user/data-usage.md) | How much data monitoring uses, and staying under a data cap |
| [Settings](user/settings.md) | Every setting, explained |
| [FAQ](user/faq.md) | Privacy, trust, fairness, and other common questions |

## I want to run, audit, or hack on it — the Technical Docs

| Document | What it covers |
|---|---|
| [Architecture](technical/architecture.md) | Modules, data flow, database schema |
| [Configuration](technical/configuration.md) | Environment variables and persisted settings reference |
| [Methodology](technical/methodology.md) | The auditable spec: detection thresholds, fault classification, statistics — the document to hand your ISP |
| [Deployment](technical/deployment.md) | The launcher, systemd, Docker, nginx, auto-update |
| [API](technical/api.md) | REST endpoints and the live event stream |
| [Security](technical/security.md) | Threat model and hardening notes |

## Contributing

The codebase is deliberately small and boring to read — that is the point of an evidence
tool. Development setup is in the top-level [README](../README.md#development);
architecture and methodology docs above are the fastest way in. Contributions are welcome,
especially from fellow northerners. Trapline is licensed under the
[GNU GPL v3.0 or later](../LICENSE).
