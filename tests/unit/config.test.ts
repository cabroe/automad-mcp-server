import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, API_BASE } from '../../src/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    for (const k of [
      'AUTOMAD_URL',
      'AUTOMAD_USER',
      'AUTOMAD_PASS',
      'AUTOMAD_WRITE_MODE',
      'LOG_LEVEL',
      'AUTOMAD_THEMES_PATH',
      'AUTOMAD_STARTER_KIT_PATH',
      'AUTOMAD_MODE',
      'AUTOMAD_HTTP_PORT',
      'AUTOMAD_HTTP_HOST',
      'AUTOMAD_HTTP_TOKEN',
    ]) {
      delete process.env[k];
    }
  });

  it('loads the canonical v2 env (with themes)', () => {
    process.env['AUTOMAD_URL'] = 'https://blog.example.com';
    process.env['AUTOMAD_USER'] = 'admin';
    process.env['AUTOMAD_PASS'] = 'secret';
    process.env['AUTOMAD_THEMES_PATH'] = '/app/packages';
    const cfg = loadConfig();
    expect(cfg.url).toBe('https://blog.example.com');
    expect(cfg.username).toBe('admin');
    expect(cfg.password).toBe('secret');
    expect(cfg.writeMode).toBe('confirm-destructive');
    expect(cfg.themesPath).toBe('/app/packages');
    expect(cfg.starterKitPath).toMatch(/templates[/\\]starter-kit$/); // default = bundled starter kit
  });

  it('defaults AUTOMAD_THEMES_PATH to <cwd>/automad-themes (theme tool always works)', () => {
    process.env['AUTOMAD_URL'] = 'https://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    expect(() => loadConfig()).not.toThrow();
    const cfg = loadConfig();
    expect(cfg.themesPath).toMatch(/automad-themes$/);
    expect(cfg.starterKitPath).toMatch(/templates[/\\]starter-kit$/); // bundled default even without themes
  });

  it('respects AUTOMAD_STARTER_KIT_PATH override', () => {
    process.env['AUTOMAD_URL'] = 'https://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    process.env['AUTOMAD_THEMES_PATH'] = '/themes';
    process.env['AUTOMAD_STARTER_KIT_PATH'] = '/templates/starter';
    const cfg = loadConfig();
    expect(cfg.themesPath).toBe('/themes');
    expect(cfg.starterKitPath).toBe('/templates/starter');
  });

  it('treats missing credentials as a soft no-op (liveEnabled=false)', () => {
    process.env['AUTOMAD_URL'] = 'https://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_THEMES_PATH'] = '/themes';
    // No AUTOMAD_PASS — server still boots, liveEnabled stays false so
    // the live-API tools return UNSUPPORTED via assertLiveEnabled.
    expect(() => loadConfig()).not.toThrow();
    const cfg = loadConfig();
    expect(cfg.mode).toBe('full');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.url).toBe('https://x');
  });

  it('exports the v2 /_api base path', () => {
    expect(API_BASE).toBe('/_api');
  });

  it('defaults to full mode with liveEnabled', () => {
    process.env['AUTOMAD_URL'] = 'https://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    const cfg = loadConfig();
    expect(cfg.mode).toBe('full');
    expect(cfg.liveEnabled).toBe(true);
  });

  it('docs mode does not require credentials and disables live', () => {
    process.env['AUTOMAD_MODE'] = 'docs';
    expect(() => loadConfig()).not.toThrow();
    const cfg = loadConfig();
    expect(cfg.mode).toBe('docs');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.url).toBe('');
  });

  it('rejects an invalid AUTOMAD_MODE', () => {
    process.env['AUTOMAD_MODE'] = 'hybrid';
    expect(() => loadConfig()).toThrow(/AUTOMAD_MODE/);
  });

  it('rejects a non-http(s) AUTOMAD_URL', () => {
    process.env['AUTOMAD_URL'] = 'ftp://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    expect(() => loadConfig()).toThrow(/http/);
  });

  it('rejects a malformed AUTOMAD_URL', () => {
    process.env['AUTOMAD_URL'] = 'not a url';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    expect(() => loadConfig()).toThrow(/valid URL/);
  });

  it('strips a trailing slash from AUTOMAD_URL', () => {
    process.env['AUTOMAD_URL'] = 'https://x.example.com/';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    expect(loadConfig().url).toBe('https://x.example.com');
  });

  it('rejects an invalid LOG_LEVEL', () => {
    process.env['AUTOMAD_URL'] = 'https://x';
    process.env['AUTOMAD_USER'] = 'u';
    process.env['AUTOMAD_PASS'] = 'p';
    process.env['LOG_LEVEL'] = 'verbose';
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);
  });

  describe('http transport config', () => {
    beforeEach(() => {
      process.env['AUTOMAD_URL'] = 'https://x';
      process.env['AUTOMAD_USER'] = 'u';
      process.env['AUTOMAD_PASS'] = 'p';
    });

    it('leaves http undefined when AUTOMAD_HTTP_PORT is unset', () => {
      expect(loadConfig().http).toBeUndefined();
    });

    it('parses a provided port, host, and token', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '7823';
      process.env['AUTOMAD_HTTP_HOST'] = '0.0.0.0';
      process.env['AUTOMAD_HTTP_TOKEN'] = 'secret-token';
      expect(loadConfig().http).toEqual({ port: 7823, host: '0.0.0.0', token: 'secret-token' });
    });

    it('defaults host to 127.0.0.1 and auto-generates a 64-hex-char token', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '7823';
      const http = loadConfig().http;
      expect(http?.host).toBe('127.0.0.1');
      expect(http?.token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects an invalid AUTOMAD_HTTP_PORT', () => {
      process.env['AUTOMAD_HTTP_PORT'] = 'notaport';
      expect(() => loadConfig()).toThrow(/AUTOMAD_HTTP_PORT/);
    });

    it('rejects an out-of-range AUTOMAD_HTTP_PORT', () => {
      process.env['AUTOMAD_HTTP_PORT'] = '70000';
      expect(() => loadConfig()).toThrow(/AUTOMAD_HTTP_PORT/);
    });
  });
});
