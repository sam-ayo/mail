-- The server no longer stores the files that AI agents upload. send_with_files
-- sends the email in the upload request, so the file stays in memory only.
DROP TABLE IF EXISTS agent_uploads;
