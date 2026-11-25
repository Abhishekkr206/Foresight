# Import Foresight test results into Jira

1. Open Jira's CSV import for your existing project or space, then select [foresight-jira-test-results.csv](foresight-jira-test-results.csv).
2. Map **Summary** to **Summary**, **Issue Type** to **Work type** (or **Issue type**), and **Description** to **Description**. Map the CSV value **Task** to the project's Task type. Review the import preview and confirm it shows 13 new work items.
3. Run the import once. Each description contains the test verdict, so it may be useful to keep failed test cases open for follow-up. Attach [execution-evidence.txt](execution-evidence.txt) and the [sign-in screenshot](login-screen.png) where needed. Jira does not pick up local attachments from description text.

If you cannot access CSV import, create one task named **Foresight Phase 4 testing** and paste [jira-single-task.txt](jira-single-task.txt) into its description. Attach the evidence to that task.

[Atlassian guide for importing CSV into an existing Jira project](https://support.atlassian.com/jira-software-cloud/docs/import-issues-into-an-existing-space-in-jira-using-csv/)
