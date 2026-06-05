const fs = require('fs');
const path = require('path');

/**
 * Extracts the changelog entry for a specific version from CHANGELOG.md
 * Usage: node extract-changelog.js <version> [output-file]
 */
function extractChangelog() {
  const version = process.argv[2];
  if (!version) {
    console.error('Error: Version argument is required.');
    process.exit(1);
  }

  // Clean the version string (e.g. remove leading 'v')
  const cleanVersion = version.replace(/^v/, '');
  const changelogPath = path.resolve(process.cwd(), 'CHANGELOG.md');

  if (!fs.existsSync(changelogPath)) {
    console.error(`Error: CHANGELOG.md not found at ${changelogPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(changelogPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  let extracting = false;
  const entryLines = [];

  // Match headers like: ## [1.6.0] - 2026-06-05 or ## 1.6.0
  const headerRegex = new RegExp(`^##\\s+\\[?${cleanVersion.replace(/\./g, '\\.')}\\]?(\\s+|$)`);
  const anyHeaderRegex = /^##\s+/;

  for (const line of lines) {
    if (anyHeaderRegex.test(line)) {
      if (extracting) {
        // We hit the next version section, stop extracting
        break;
      }
      if (headerRegex.test(line)) {
        extracting = true;
        continue; // Skip the version header itself
      }
    }

    if (extracting) {
      entryLines.push(line);
    }
  }

  if (entryLines.length === 0) {
    console.error(`Error: Could not find changelog entry for version ${cleanVersion}`);
    process.exit(1);
  }

  // Clean up leading/trailing empty lines
  const entryText = entryLines.join('\n').trim();

  const outputPath = process.argv[3];
  if (outputPath) {
    fs.writeFileSync(path.resolve(process.cwd(), outputPath), entryText, 'utf-8');
    console.log(`Changelog for ${cleanVersion} written to ${outputPath}`);
  } else {
    console.log(entryText);
  }
}

extractChangelog();
