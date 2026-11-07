<!--
Thank you for contributing to Magic-Link!
Please fill out this template to help us review your PR.
-->

## Description

<!-- Provide a clear and concise description of your changes -->

## Related Issue(s)

<!-- Link to related issues. Use "Closes #123" or "Fixes #123" to auto-close issues -->

- Closes #
- Related to #

## Type of Change

<!-- Put an `x` in all boxes that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Enhancement (improving existing functionality)
- [ ] Documentation update
- [ ] UI/UX improvement
- [ ] Code refactoring
- [ ] Performance improvement
- [ ] Security improvement

## Feature Area

<!-- Which part of the plugin does this affect? -->

- [ ] Magic Link Authentication
- [ ] Email OTP
- [ ] TOTP / MFA
- [ ] Token Management
- [ ] IP Banning / Rate Limiting
- [ ] JWT Sessions
- [ ] Email Configuration
- [ ] Template Customization
- [ ] Admin UI
- [ ] API / Backend
- [ ] License System
- [ ] Documentation

## Testing

<!-- Describe the tests you ran to verify your changes -->

- [ ] I have tested these changes locally
- [ ] I have tested authentication functionality
- [ ] I have tested with different auth modes (if applicable)
- [ ] New and existing tests pass locally with my changes
- [ ] `npm run lint`, `npm run format:check`, `npm test`, `npm run build` and `npm run verify` pass

### Test Environment

- **Plugin Version**:
- **Strapi Version**:
- **Node Version**:
- **OS**:

### Authentication Testing

<!-- If applicable, describe how you tested auth functionality -->

- [ ] Tested Magic Link flow
- [ ] Tested Email OTP flow
- [ ] Tested TOTP setup and verification
- [ ] Verified token generation and validation
- [ ] Tested rate limiting

## Screenshots/Videos

<!-- If applicable, add screenshots of dashboard, settings, or auth flow -->

## Checklist

<!-- Put an `x` in all boxes that apply -->

- [ ] My code follows the project's code style
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have checked that my PR follows [Conventional Commits](https://conventionalcommits.org)
- [ ] I have removed any sensitive information (credentials, API keys)

## Breaking Changes

<!-- If this introduces breaking changes, describe the impact and migration path -->

## Additional Context

<!-- Add any other context about the PR here -->

---

**PR Title Format**: Please use conventional commits format:

- `feat: add login link expiry presets`
- `fix: resolve token validation issue`
- `docs: update authentication configuration`
