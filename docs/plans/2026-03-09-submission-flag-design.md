# Submission Flag Design

## Overview

Add colored flag markers to submission records. Teachers/admins mark submissions; students can see flags but not modify them.

## Flag Types

| Color  | Value    | Meaning  |
|--------|----------|----------|
| Red    | `red`    | Worth showcasing |
| Blue   | `blue`   | Needs explanation |
| Green  | `green`  | Excellent work |
| Yellow | `yellow` | Needs improvement |

Each submission can have at most one flag. Setting a new flag replaces the old one. Setting `null` removes the flag.

## Approach: Single Field on Submission Model

Add a nullable `flag` CharField with choices to the Submission model. No separate table needed.

## Backend Changes

### Model

`Submission.flag` — `CharField(max_length=10, choices=FLAG_CHOICES, null=True, blank=True, default=None)`

### API

- `PUT /api/submission/{id}/flag` — set or clear flag, restricted to ADMIN/SUPER roles
  - Input: `{ flag: "red" | "blue" | "green" | "yellow" | null }`
  - Returns updated submission
- `GET /api/submission/` — add `flag` to SubmissionOut schema and SubmissionFilter

### Migration

One migration adding the `flag` field.

## Frontend Changes

### Submissions Table (Submissions.vue)

- New "flag" column displaying a colored flag icon
- Teachers/admins: click to open a popover with 4 color options + clear
- Students: icon display only, no interaction

### Filtering

- Add flag color dropdown filter alongside existing username filter
- Options: all / red / blue / green / yellow / flagged (any) / unflagged

## Permissions

- **Mark/unmark**: SUPER and ADMIN roles only
- **View flags**: all authenticated users
