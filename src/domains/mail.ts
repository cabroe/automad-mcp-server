import { AutomadMcpError } from '../errors.js';
import { API_BASE } from '../config.js';
import type { HttpClient } from '../client.js';
import type { WriteGuard, WriteAction } from '../write-guard.js';
import type { MailInput } from '../schemas.js';

type MailAction = MailInput['action'];
const ACTION_MAP: Record<MailAction, WriteAction> = {
  save: 'mail.save',
  test: 'mail.test',
  reset: 'mail.reset',
};

export async function handleMail(
  input: MailInput,
  client: HttpClient,
  guard: WriteGuard,
): Promise<unknown> {
  const permit = guard.check(ACTION_MAP[input.action], '/', input.confirm_token);
  if (permit.allowed === false) throw new AutomadMcpError('FORBIDDEN', permit.reason);
  if (permit.allowed === 'pending') return permit;
  switch (input.action) {
    case 'save': {
      if (!input.transport) throw new AutomadMcpError('VALIDATION', 'transport is required for save');
      if (!input.from) throw new AutomadMcpError('VALIDATION', 'from is required for save');
      const body: Record<string, unknown> = { transport: input.transport, from: input.from };
      if (input.smtpServer) body['smtpServer'] = input.smtpServer;
      if (input.smtpUsername) body['smtpUsername'] = input.smtpUsername;
      if (input.smtpPassword) body['smtpPassword'] = input.smtpPassword;
      if (input.smtpPort !== undefined) body['smtpPort'] = input.smtpPort;
      return client.post(`${API_BASE}/mail-config/save`, body);
    }
    case 'test': {
      if (!input.to) throw new AutomadMcpError('VALIDATION', 'to is required for test');
      return client.post(`${API_BASE}/mail-config/test`, { to: input.to });
    }
    case 'reset':
      return client.post(`${API_BASE}/mail-config/reset`, {});
    default: {
      throw new AutomadMcpError('VALIDATION', `unknown mail action: ${String(input.action)}`);
    }
  }
}
