/**
 * Selects truthful success copy for a token creation request.
 *
 * @param {{ sendEmail?: boolean, email?: string }} options - The submitted delivery choice and recipient.
 * @returns {{ messageId: string, values: Record<string, string> }} Translation key and interpolation values.
 */
export const getTokenCreationNotice = ({ sendEmail, email } = {}) => (
  sendEmail
    ? { messageId: 'tokens.notifications.created', values: { email: email || '' } }
    : { messageId: 'tokens.notifications.createdWithoutEmail', values: {} }
);
