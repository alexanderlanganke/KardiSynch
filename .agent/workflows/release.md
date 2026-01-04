---
description: How to release a new version
---

# Release Workflow

This project uses `release-it` to automate version management and git tagging, ensuring semantic versioning compliance.

## Prerequisites

- Ensure you are on the `main` branch.
- Ensure your working directory is clean.
- Ensure you have a `GITHUB_TOKEN` environment variable set if you want to create GitHub releases automatically (or rely on the interactive prompt).

## Creating a Release

1. Run the release command:
    ```bash
    npm run release
    ```
2. Follow the interactive prompts:
    - Select the version bump (patch, minor, major).
    - Confirm the git tag creation.
    - Confirm the push to GitHub.

## Publishing Artifacts

After `release-it` pushes the new tag to GitHub, you need to build and publish the artifacts (including `latest.yml` for auto-updates).

**Note**: If you have a CI/CD pipeline (like GitHub Actions), this should happen automatically on tag push. If running locally:

1. Run the publish command:
    ```bash
    npm run publish:gh
    ```
    This will build the app and upload artifacts to the **Draft** GitHub Release created in the previous step.
    This will build the app and upload artifacts to the **Draft** GitHub Release created in the previous step.
2. **Finalize**: Go to the [GitHub Releases page](https://github.com/alexanderlanganke/KardiSynch/releases), check the artifacts, and edit the release to publish it (uncheck "Draft"). This ensures users don't get half-uploaded releases.

## Interactive Guide (release-it)

When you run `npm run release`, you will see these prompts. Here is what to select:

1.  **Select increment (next version)**:
    - Choose `patch` (1.0.x) for bug fixes.
    - Choose `minor` (1.x.0) for new features.
2.  **Commit (chore: release vX.X.X)?**:
    - Type **Yes** (or press Enter). This saves the version change to git.
3.  **Tag (vX.X.X)?**:
    - Type **Yes**. This creates the git reference for the release.
4.  **Push?**:
    - Type **Yes**. This sends the commit and tag to GitHub.
    - *Note: You need `GITHUB_TOKEN` set for this to work smoothly, otherwise it might ask for credentials or fail if using HTTPS.*
5.  **Create a release on GitHub?**:
    - **SKIPPED / NO**. The configuration disables this.
    - We let the CI (GitHub Actions) create the release using `electron-builder` to ensure artifacts are correct.
    - *If asked (unexpectedly), answer NO.*


## Troubleshooting

- **404 Error on Update Check**: This usually means `latest.yml` is missing from the GitHub Release assets. Ensure `npm run publish:gh` completed successfully.
