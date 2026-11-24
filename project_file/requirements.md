# Foresight project report requirements

This working brief defines the content, design, evidence, and production phases for the academic software engineering report. Update this brief before drafting each phase when a decision changes the report.

## Production phases

Draft and review one phase at a time. Keep the original index's visible chapter order in the report. The phases below are the order of production.

| Phase | Deliverable |
| --- | --- |
| 1. Project context and requirement analysis | Draft the problem statement, conservation motivation, prototype scope, requirements, and SRS. Place the approved Level-1 DFD, create the matching Level-0 DFD, and prepare the use-case diagram, templates, and data dictionary. Capture the working screens and reserve a hardware photo slot. |
| 2. Project management | Draft the process model, reconstruct documented milestones, build the Gantt chart, count function points from the Level-1 DFD, estimate effort, duration, and labour cost, and add a compact risk table. |
| 3. Design engineering and coding | Document the architecture, module hierarchy, beacon-to-dashboard workflow, audio processing, and scoring calculations. Create the remaining design figures and document officer sign-in, including its sequence diagram, credential configuration, pseudocode, and code excerpts. |
| 4. Testing | Revisit testing with the project team after the design and coding draft. Record verified MVP results and document the implemented login test cases, control-flow graph, complexity calculation, and independent paths. |
| 5. Final assembly | Add the cover when details are available. Check contents, captions, figure and table numbering, cross-references, page breaks, and print legibility. Export the final PDF after review. |

## Report design

- Use a restrained research-paper style with a single-column body, a clear numbered heading hierarchy, generous margins, and consistent typography. Use a readable serif body face and one muted accent for headings, links, or diagram categories.
- Keep paragraphs concise and use tables for requirements, data dictionary entries, estimates, and test cases. Use displayed equations for core calculations and include the worked scoring example.
- Put numbered captions beneath figures and above tables. Refer to each figure and table in the surrounding text. Keep labels readable at the final page size, including in grayscale. Use a landscape page for a dense figure if it improves legibility.
- Use Arial throughout the figures, with black text, white backgrounds, and grayscale connectors. Use color sparingly when it conveys meaning. Use consistent process names, actor names, store IDs, and flow labels across the DFDs and data dictionary. Draw processes as circles, data stores as two horizontal lines open at both sides, and external entities as rectangles.
- Cite the repository for implemented behavior, external sources for benchmarks and methods, and identified project records for dates or hardware evidence. Label proposed functionality, estimates, and illustrative examples where they appear.

## 1. Project context

Foresight is a forest acoustic monitoring prototype for forest officers. Remote acoustic beacons can help officers review environmental sounds and investigate signals such as chainsaws or vehicles across a monitored area.

The project was inspired by the need to protect wildlife habitats, including those of endangered species, from human disturbance. The long-term goal is to give conservation teams continuous acoustic observations that help them investigate threats and understand changes in ecosystem activity. Present animal and bird sounds as context about soundscape activity. Species identification and ecological validation remain future work.

- **Inputs** — An ESP32 beacon or the simulator supplies recordings and beacon status. The Scenario Lab can inject sample sounds into configured zones to demonstrate the monitoring workflow.
- **Processing** — The FastAPI backend classifies audio with YAMNet, calculates the Acoustic Complexity Index (ACI), scores potential threats, and correlates detections from nearby beacons.
- **Storage and delivery** — SQLAlchemy persists monitoring records in SQLite or PostgreSQL. The React dashboard receives data through REST and WebSockets. Supabase Storage can host qualifying recordings when configured.
- **Monitoring** — The dashboard presents beacon coverage, live status, forest health, and event history. Supporting features include live audio, event replay, and the Forest Insight assistant.
- **Scope** — Map coordinates represent the Tapajós National Forest area for demonstration. The forest health score is an indicator based on recent acoustic observations. Describe physical beacon integration and hosted services according to the evidence available.

The proposed report workflows are monitoring beacon coverage and forest health, investigating an acoustic event, and running a Scenario Lab demonstration. Include the sign-in flow where relevant.

### Beacon firmware and audio quality

Describe the ESP32-S3, INMP441 I2S microphone, OLED, Wi-Fi audio uploads, and heartbeat reporting. The firmware shifts signed 32-bit microphone samples right by 16 bits. For uploads it zeroes samples below a tunable fixed noise floor, applies digital gain, and clamps the result to the signed 16-bit PCM range of −32,768 to 32,767. The OLED uses a separate path. It picks the sample with the greatest absolute magnitude in each display bucket, preserves its sign, applies the display noise floor, and scales it around the centerline using a tunable peak range.

The microphone loop passes audio chunks to a separate networking task through a bounded queue. If congestion fills the queue, the firmware can drop a chunk and log the condition while capture and display continue. Document the first-order high-pass filter, adaptive noise estimate, and short gate hold as proposed refinements. The design would use the high-pass filter to remove bias and slow drift, set the threshold to the greater of a minimum floor and a multiple of estimated ambient noise, and briefly hold the gate open to preserve the waveform through zero crossings.

### Classification, scoring, and forest health

- **Classification** — The backend decodes and resamples incoming audio for YAMNet. Cover examples such as chainsaws, gunshots, engines, vehicles, chopping, wind, and bird sounds. When needed, the local fallback considers spectral and temporal features such as transient behavior and sustained energy. Simulation hints can supply demo labels. Explain why loudness alone is insufficient to distinguish a gunshot from an engine or chainsaw.
- **ACI approximation** — Split the recording into complete 512-sample frames and compute the magnitude of the real FFT for each frame. For each frequency bin, divide the sum of absolute differences between adjacent frames by the sum of magnitudes from the second frame onward. Use zero for bins with a denominator at or below `1e-8`. Average across bins and clamp to `[0, 1]`. Fewer than two full frames produce zero.
- **Per-event scoring** — The threat score is the largest product of confidence and class weight among threat classes that meet the confidence threshold. Use zero if none qualify. Relative ACI drop is `max(0, baseline − ACI) / baseline`. The final score is `clamp(0.7 × threat score + 0.3 × ACI drop, 0, 1)`. For example, chainsaw confidence of 0.80 with weight 0.90 gives 0.72. With ACI of 0.24 against an illustrative baseline of 0.30, the drop is 0.20 and the final score is 0.564.
- **Event correlation** — Qualifying detections from different beacons within the configured time window are grouped and marked confirmed. The current implementation uses classifier confidence as a proxy to select a beacon for the proximity estimate. It applies a time and score rule across distinct beacons.
- **Dashboard forest health** — Average baseline-normalized ACI within each observed zone, then deduct 0.35 times the severity of its strongest recent qualifying threat. Clamp each zone score and weight observed zones equally in the dashboard average. Show coverage alongside the score and show a waiting state when there are no recent observations.

### Scaling and engineering lessons

The current backend runs uploaded-audio processing off the API event loop, and a separate queue handles optional storage uploads. Describe deployments of hundreds of beacons as future design. Lightweight on-device filtering could send relevant events, metadata, and short audio segments. An ingestion queue could distribute recordings to parallel inference workers and support horizontal scaling. Heartbeats and event metadata could follow a lightweight path while recordings await analysis. LoRa/LoRaWAN is a candidate for low-power metadata delivery through a gateway. Larger audio clips would use a higher-bandwidth connection.

Capture the engineering lessons on microphone calibration, noise suppression, signal scaling, audio encoding, network stability, model loading, backend processing, and readable visual feedback. Use the separate firmware capture and networking tasks as the concrete example of keeping local audio and display responsive during delays.

## 2. Forest officer sign-in

The implemented login compares the submitted login ID and password with server-side configuration. It issues a one-hour signed JWT on success. The browser stores the bearer token in `sessionStorage`, rechecks it when restoring a session, and clears it on sign-out, expiry, or an authentication failure. Document these flows using current code and observed test results.

## 3. Report outline

Follow the original contents image for the visible chapter order and numbering. Use the SafeGuard AI index and previous-year reports as examples for presenting individual sections.

| Section | Required content |
| --- | --- |
| Problem Statement | Explain the monitoring problem, intended users, objectives, proposed solution, scope, and prototype limitations. |
| Process Model | Explain the development model and give a sprint-by-sprint account of delivered features. Confirm the model, sprint boundaries, and dates against project records. |
| 1. Requirement Analysis | Include **1.1** requirements and working screens, **1.2** Level-0 DFD, **1.3** Level-1 DFD, **1.4** data dictionary, **1.5** use-case diagram, **1.6** use-case templates, **1.7** login and credential configuration, **1.8** sequence diagram, and **1.9** SRS. |
| 2. Project Management | Include **2.1** timeline or Gantt chart, **2.2** function point analysis derived from the Level-1 DFD, **2.3** effort, cost, and time estimates with assumptions, and **2.4** risk table with likelihood, impact, and mitigation. |
| 3. Design Engineering | Include **3.1** architectural design, **3.2** structure chart, and **3.3** login pseudocode. |
| 4. Coding | Include **4.1** login route, **4.2** JWT session check, **4.3** sign-in page and API helper, **4.4** credential configuration, and **4.5** end-to-end walkthrough. |
| 5. Testing | Include **5.1** white-box testing with a numbered control-flow graph, cyclomatic complexity calculation, and independent paths derived from the login pseudocode. Include **5.2** black-box test cases for valid credentials, invalid credentials, empty fields, and invalid or expired tokens. Include test evidence for implemented MVP features where available. |
| Tools and Resources Used | Record frameworks, models, tooling, datasets or audio sources, and references. Include provisionally as a closing section based on the SafeGuard AI example. |

The data dictionary covers processes, external entities, data stores, data flows, data structures, and data elements. Use the same names across both DFD levels and the dictionary. The SRS covers introduction, overall description, and specific requirements. Give each requirement an identifier and status, and connect it to relevant use cases or tests. Use-case templates include actors, trigger, preconditions, main flow, alternate flows, and postconditions.

### Project management estimation

- Use commit dates and available project records for the Gantt chart. Label inferred phase boundaries and leave undocumented sprint dates open.
- Use the assigned software sizing and FP estimation sections. Show the weighted count and distinguish the adjustment assumptions from the observed system features. [Course guidelines, Unit 4](../reference/guidelines/guidelines.pdf#page=1) · [Pressman and Maxim, 9th ed., §§25.6.1 and 25.6.4](../reference/pressman-maxim-software-engineering-9e.pdf#page=547)
- Use the teacher's figures of 10 FP per person-month and ₹50,000 per developer-month. Divide the FP estimate by productivity to get effort, multiply effort by the monthly salary to get labour cost, and divide effort by the assumed full-time staffing to estimate elapsed months.

## 4. Figures, screenshots, and evidence

| Item | What to show |
| --- | --- |
| Level-0 DFD | Show Foresight as one process. Balance the boundary flows with the approved Level-1 DFD, including the officer, physical beacon, and simulator inputs. |
| Level-1 DFD | Use the approved Graphviz figure for the working monitoring scope. It shows ingestion, classification and scoring, event correlation, dashboard delivery, and four data stores. Cover sign-in in its own sequence diagram. |
| Use-case diagram | Label the forest officer by role and use “Sign in” in the figure. Explain the implementation status of sign-in in the accompanying report text. |
| Architecture and structure chart | Show deployment and communication boundaries in the architecture diagram. Show module hierarchy and responsibilities in the structure chart. |
| Beacon-to-dashboard diagram | Trace microphone capture, heartbeat and audio uploads, backend scoring and correlation, persistence, and dashboard updates. Identify simulation as another input to the pipeline. |
| Signal-processing diagram | Show the shared I2S input and the distinct PCM upload and OLED display paths. Label the high-pass filter, adaptive gate, and hold as proposed if included. |
| Login sequence and control-flow graph | Trace credential submission, server configuration checks, and token issuance or rejection in the sequence diagram. Base the numbered control-flow graph and path calculations on the same pseudocode used in Design Engineering. |
| Gantt chart | Show sprints or phases, dates, and dependencies. Confirm dates before assigning them to delivered work. |
| Working screens | Capture the running app at 1920 × 1080 in a desktop viewport, without browser chrome. Include a dashboard overview, Scenario Lab with an active scenario, and event detail from that same scenario. Label simulated data in captions. |
| Hardware photo | Reserve a captioned placeholder for the physical beacon photo. |

Graphviz is the default for the DFDs. Use SVG for report figures and keep editable sources in `project_file/diagrams`. Keep PNG diagram previews in `project_file/diagram-previews` and working-screen PNGs in `project_file/screenshots` when captured. Use stable descriptive filenames. The approved Level-1 DFD is available as [report SVG](diagrams/foresight-level-1-dfd.svg), [Graphviz source](diagrams/foresight-level-1-dfd.dot), [editable draw.io copy](diagrams/foresight-level-1-dfd.drawio), and [PNG preview](diagram-previews/foresight-level-1-dfd.png).

Give each figure a number, caption, and a reference in the associated section. Keep diagram labels legible at report size. Distinguish expected test results from observed results. Record a pass or fail only when there is a test run or other verified evidence. State the assumptions behind function point weights, productivity, and cost estimates.

### Source material

- [Original contents image](demo_files%26img/image.png) for the outline. The image ends during the Testing section.
- [SafeGuard AI index page 1](demo_files%26img/Screenshot%202026-11-24%20162730.png) and [page 2](demo_files%26img/Screenshot%202026-11-24%20162741.png) for requirements, planning, coding, testing, and the tools section.
- [SafeSky](demo_files%26img/SOFTWARE%20ENGINEERING%20PROJECT%20doc.pdf) for login testing, control-flow graphs, and captioned screenshots.
- [TherapEase](demo_files%26img/TherapEase.pdf) for DFDs, structure and sequence diagrams, and workflow-grouped screens.
- [Timetable Management System](demo_files%26img/Timetable_Management_System-2.pdf) for use-case presentation, lists of figures and tables, and Gantt task dependencies.
- [Foresight README](../README.md), [backend](../backend/app/), [frontend](../frontend/src/), and [backend tests](../backend/tests/) for implemented features and technical evidence.
- [Project context notes](../PROJECT_CONTEXT.txt), [beacon firmware](../firmware/foresight_beacon/foresight_beacon.ino), [audio processing](../backend/app/audio.py), [scoring](../backend/app/scoring.py), [event pipeline](../backend/app/pipeline.py), and [zone health calculation](../backend/app/health.py) for implementation details. Cross-check the context notes against the current code and physical prototype.

## 5. Open for discussion

- Cover-page details, team information, and any institution-specific submission format or page limit are deferred to final assembly.
- Confirmed process model and sprint history, function point counts, and calculated effort, duration, and cost belong to Phase 2.
- Phase 4 results are recorded in the report and the Jira CSV. Review the failed UI checks before final submission.
- Physical beacon wiring, hardware test observations, and which physical and simulated beacons were active during the demo. The context notes and checked-in firmware list different microphone pins.
- Final report order after Testing and any additional sections required by the course.
