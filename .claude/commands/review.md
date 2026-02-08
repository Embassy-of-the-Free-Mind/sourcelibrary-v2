Review the current changes for issues before committing.

1. Run `git diff` to see all unstaged changes and `git diff --cached` for staged
2. Check for:
   - Security issues (hardcoded secrets, XSS, injection)
   - Logic bugs or edge cases
   - Missing error handling at system boundaries
   - Breaking changes to existing APIs or interfaces
   - Anything that would confuse another developer reading this code
3. Give a brief summary: what's good, what needs fixing
4. If there are issues, fix them directly — don't just report
