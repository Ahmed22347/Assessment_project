#!/bin/sh
# Vercel "Ignored Build Step": exit 0 = skip the build, exit 1 = build.
# Skip only when the latest commit changed nothing except persisted QA data
# (reviews/, data/uploaded-calls/), which the app reads live from the GitHub API.
# On any doubt (first commit, shallow clone, git error) we build.

if ! git rev-parse -q --verify HEAD^ >/dev/null 2>&1; then
  echo "No parent commit available - building."
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- . ':(exclude)reviews' ':(exclude)data/uploaded-calls'; then
  echo "Only QA data changed - skipping build."
  exit 0
fi

echo "Code changed - building."
exit 1
