const REPO = 'alexanderlanganke/KardiSynch';
const MAX_URL_LENGTH = 8000; // browsers truncate around 8k–10k

export function buildGitHubIssueUrl(opts: {
  errorMessage: string;
  stack?: string;
  source: string;
  appVersion?: string;
  electronVersion?: string;
  platform?: string;
}): string {
  const title = `Crash: ${opts.errorMessage.slice(0, 100)}`;

  let body = `## Crash Report

**Source:** ${opts.source}
**App version:** ${opts.appVersion ?? 'unknown'}
**Electron:** ${opts.electronVersion ?? 'unknown'}
**Platform:** ${opts.platform ?? 'unknown'}

### Error
\`\`\`
${opts.errorMessage}
\`\`\`

### Stack trace
\`\`\`
${opts.stack ?? 'No stack trace available'}
\`\`\`

### Steps to reproduce
<!-- Please describe what you were doing when this crash occurred -->

`;

  // Truncate body if the resulting URL would be too long
  const baseUrl = `https://github.com/${REPO}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=`;
  const maxBodyLength = MAX_URL_LENGTH - baseUrl.length;
  const encodedBody = encodeURIComponent(body);
  const finalBody = encodedBody.length > maxBodyLength
    ? encodeURIComponent(body.slice(0, maxBodyLength / 3) + '\n\n[truncated — full details in log file]')
    : encodedBody;

  return baseUrl + finalBody;
}
