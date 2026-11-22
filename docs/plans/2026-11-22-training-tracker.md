# Training Tracker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a first usable phone logger, public workout history and journal, and health provider connections.

**Architecture:** PostgreSQL holds planned and completed workouts, journal content, normalized observations, and encrypted provider credentials. Public routes query an explicit subset. Google sign-in protects each owner operation.

**Tech Stack:** Next.js, TypeScript, PostgreSQL, Auth.js

---

1. Add a local database, base schema, and bootstrap script. Apply the schema twice against a disposable database.
2. Test workout summaries, day matching, and the public visibility rules, then implement public pages and daily metrics.
3. Add owner sign-in and authenticated mutations. Verify anonymous access is denied and signed-in changes appear on public pages.
4. Implement the exercise library, field definitions, planner, and set logger.
5. Implement Google Health and Withings authorization, token storage, and idempotent sync.
6. Add journal drafts and photo uploads, then run type checking, tests, and a production build.
