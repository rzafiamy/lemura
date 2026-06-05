const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const OWNER = 'rzafiamy';
const REPO = 'lemura';

async function backfill() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is required.');
    console.error('Please run: export GITHUB_TOKEN="your_personal_access_token"');
    process.exit(1);
  }

  // 1. Get all local tags
  let tags = [];
  try {
    const stdout = execSync('git tag', { encoding: 'utf-8' });
    tags = stdout.split('\n').map(t => t.trim()).filter(Boolean);
  } catch (error) {
    console.error('Error listing git tags:', error.message);
    process.exit(1);
  }

  if (tags.length === 0) {
    console.log('No tags found in the repository.');
    return;
  }

  console.log(`Found ${tags.length} tags: ${tags.join(', ')}`);

  // 2. Iterate through each tag
  for (const tag of tags) {
    const cleanVersion = tag.replace(/^v/, '');
    const body = getChangelogForVersion(cleanVersion);

    if (!body) {
      console.warn(`⚠️ Warning: No changelog found in CHANGELOG.md for tag ${tag} (version ${cleanVersion}). Skipping.`);
      continue;
    }

    console.log(`\nProcessing release for ${tag}...`);

    try {
      // 3. Check if release already exists on GitHub
      const checkUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`;
      const response = await fetch(checkUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Node.js-Fetch'
        }
      });

      if (response.status === 200) {
        // Release exists, update it
        const release = await response.json();
        console.log(`Tag ${tag} already has a release (ID: ${release.id}). Updating release description...`);

        const updateUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}`;
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Node.js-Fetch'
          },
          body: JSON.stringify({
            body: body
          })
        });

        if (updateResponse.status === 200) {
          console.log(`✅ Successfully updated release for ${tag}`);
        } else {
          const errMsg = await updateResponse.text();
          console.error(`❌ Failed to update release for ${tag}: ${updateResponse.status} - ${errMsg}`);
        }
      } else if (response.status === 404) {
        // Release does not exist, create a new one
        console.log(`No release found for tag ${tag}. Creating a new release...`);

        const createUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
        const createResponse = await fetch(createUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Node.js-Fetch'
          },
          body: JSON.stringify({
            tag_name: tag,
            name: tag,
            body: body,
            draft: false,
            prerelease: false
          })
        });

        if (createResponse.status === 201) {
          console.log(`✅ Successfully created release for ${tag}`);
        } else {
          const errMsg = await createResponse.text();
          console.error(`❌ Failed to create release for ${tag}: ${createResponse.status} - ${errMsg}`);
        }
      } else {
        const errMsg = await response.text();
        console.error(`❌ Error checking tag ${tag}: ${response.status} - ${errMsg}`);
      }
    } catch (err) {
      console.error(`❌ Error communicating with GitHub for tag ${tag}:`, err.message);
    }
  }

  console.log('\nBackfill completed.');
}

function getChangelogForVersion(cleanVersion) {
  const changelogPath = path.resolve(process.cwd(), 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) {
    return null;
  }
  const content = fs.readFileSync(changelogPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  let extracting = false;
  const entryLines = [];

  const headerRegex = new RegExp(`^##\\s+\\[?${cleanVersion.replace(/\./g, '\\.')}\\]?(\\s+|$)`);
  const anyHeaderRegex = /^##\\s+/;

  for (const line of lines) {
    if (anyHeaderRegex.test(line)) {
      if (extracting) {
        break;
      }
      if (headerRegex.test(line)) {
        extracting = true;
        continue;
      }
    }
    if (extracting) {
      entryLines.push(line);
    }
  }

  if (entryLines.length === 0) {
    return null;
  }
  return entryLines.join('\n').trim();
}

backfill();
