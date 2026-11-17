// API tests: TypeScript (Playwright's request fixture), Java (REST Assured +
// TestNG) and Python (requests + pytest). Body checks compare values as text,
// so "5" in the manual test matches 5 in the JSON.
import { q, body, headerLines, uniqueNames, VERSIONS } from './common.js';
import { pomXml } from './selenium.js';
import { slug, snake, pascal, camel } from '../model.js';

const headersObject = (headers) => Object.fromEntries((headers || []).map((h) => [h.name, h.value]));

function tsLine(a) {
  switch (a.type) {
    case 'request': {
      const opts = [`method: ${q(a.method)}`];
      if (a.headers?.length) opts.push(`headers: ${JSON.stringify(headersObject(a.headers))}`);
      if (a.body) opts.push(`data: ${a.body}`);
      return [`response = await request.fetch(${q(a.path)}, { ${opts.join(', ')} });`, 'body = await response.json().catch(() => undefined);'];
    }
    case 'expectStatus': return `expect(response.status()).toBe(${a.code});`;
    case 'expectBody':
      if (a.equals !== undefined) return `expect(asText(jsonPath(body, ${q(a.path)}))).toBe(${q(a.equals)});`;
      if (a.contains !== undefined) return `expect(asText(jsonPath(body, ${q(a.path)}))).toContain(${q(a.contains)});`;
      return `expect(jsonPath(body, ${q(a.path)}) ?? null).not.toBeNull();`;
    case 'wait': return `await new Promise((r) => setTimeout(r, ${a.ms}));`;
    default: return '// TODO (manual): UI step in an API test: move it to the UI suite';
  }
}

function javaLine(a) {
  switch (a.type) {
    case 'request': {
      let chain = 'given()';
      for (const h of a.headers || []) chain += `.header(${q(h.name)}, ${q(h.value)})`;
      if (a.body) chain += `.contentType("application/json").body(${q(a.body)})`;
      return `response = ${chain}.when().request(${q(a.method)}, ${q(a.path)});`;
    }
    case 'expectStatus': return `Assert.assertEquals(response.statusCode(), ${a.code});`;
    case 'expectBody':
      if (a.equals !== undefined) return `Assert.assertEquals(text(response.jsonPath().get(${q(a.path)})), ${q(a.equals)});`;
      if (a.contains !== undefined) return `Assert.assertTrue(text(response.jsonPath().get(${q(a.path)})).contains(${q(a.contains)}));`;
      return `Assert.assertNotNull(response.jsonPath().get(${q(a.path)}), ${q(`Expected ${a.path} in the response`)});`;
    case 'wait': return `Thread.sleep(${a.ms});`;
    default: return '// TODO (manual): UI step in an API test: move it to the UI suite';
  }
}

function pyLine(a) {
  switch (a.type) {
    case 'request': {
      const args = [q(a.method), `url(base_url, ${q(a.path)})`];
      if (a.headers?.length) args.push(`headers=${JSON.stringify(headersObject(a.headers))}`);
      if (a.body) args.push(`json=json.loads(${q(a.body)})`);
      args.push('timeout=30');
      return `response = requests.request(${args.join(', ')})`;
    }
    case 'expectStatus': return `assert response.status_code == ${a.code}, response.text`;
    case 'expectBody':
      if (a.equals !== undefined) return `assert as_text(json_path(response.json(), ${q(a.path)})) == ${q(a.equals)}`;
      if (a.contains !== undefined) return `assert ${q(a.contains)} in as_text(json_path(response.json(), ${q(a.path)}))`;
      return `assert json_path(response.json(), ${q(a.path)}) is not None`;
    case 'wait': return `time.sleep(${a.ms / 1000})`;
    default: return '# TODO (manual): UI step in an API test: move it to the UI suite';
  }
}

export function apiTypescript(plans, { baseUrl, projectName }) {
  const names = uniqueNames(plans, (p) => slug([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line: tsLine, indent: '  ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    return {
      path: `tests/${names[i]}.spec.ts`,
      content: `import { test, expect, type APIResponse } from '@playwright/test';
import { jsonPath, asText } from '../support/json';

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
test(${q(title)}, async ({ request }) => {
  let response: APIResponse;
  let body: unknown;
${lines.join('\n')}
});
`,
    };
  });
  files.push(
    {
      path: 'support/json.ts',
      content: `/** "data.items[0].id" -> the value at that path, or undefined. */
export function jsonPath(value: unknown, path: string): unknown {
  return path.replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean)
    .reduce<unknown>((cur, key) => (cur == null ? undefined : (cur as Record<string, unknown>)[key]), value);
}

/** Values compare as text, so "5" in a manual test matches 5 in JSON. */
export const asText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));
`,
    },
    { path: 'package.json', content: JSON.stringify({ name: slug(projectName), private: true, scripts: { test: 'playwright test' }, devDependencies: { '@playwright/test': VERSIONS.playwrightNpm } }, null, 2) + '\n' },
    {
      path: 'playwright.config.ts',
      content: `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Set BASE_URL to run against another environment.
    baseURL: process.env.BASE_URL ?? ${q(baseUrl || 'http://localhost:3000')},
    extraHTTPHeaders: process.env.API_TOKEN ? { Authorization: \`Bearer \${process.env.API_TOKEN}\` } : {},
  },
});
`,
    },
    { path: '.gitignore', content: 'node_modules/\ntest-results/\nplaywright-report/\n' },
  );
  return {
    files,
    run: ['npm install', 'npx playwright test'],
    env: [['BASE_URL', 'The API under test', baseUrl || 'http://localhost:3000'], ['API_TOKEN', 'Sent as a Bearer token when set', '(none)']],
  };
}

export function apiJava(plans, { baseUrl, projectName }) {
  const names = uniqueNames(plans, (p) => pascal([p.test.id, p.test.title].filter(Boolean).join(' '), 50));
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line: javaLine, indent: '        ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    return {
      path: `src/test/java/generated/${names[i]}Test.java`,
      content: `package generated;

import static io.restassured.RestAssured.given;

import io.restassured.response.Response;
import org.testng.Assert;
import org.testng.annotations.Test;

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
public class ${names[i]}Test extends BaseApiTest {

    @Test(description = ${q(title)})
    public void ${camel(names[i])}() throws Exception {
        Response response = null;
${lines.join('\n')}
    }
}
`,
    };
  });
  files.push(
    {
      path: 'src/test/java/generated/BaseApiTest.java',
      content: `package generated;

import io.restassured.RestAssured;
import io.restassured.filter.log.LogDetail;
import org.testng.annotations.BeforeClass;

/**
 * BASE_URL   the API under test
 * API_TOKEN  sent as a Bearer token when set
 */
public abstract class BaseApiTest {

    @BeforeClass
    public void configure() {
        RestAssured.baseURI = env("BASE_URL", ${q(baseUrl || 'http://localhost:3000')});
        String token = env("API_TOKEN", "");
        if (!token.isEmpty()) RestAssured.requestSpecification = RestAssured.given().header("Authorization", "Bearer " + token);
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails(LogDetail.ALL);
    }

    protected static String env(String name, String fallback) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) value = System.getProperty(name);
        return value == null || value.isEmpty() ? fallback : value;
    }

    /** Values compare as text, so "5" in a manual test matches 5 in JSON. */
    protected static String text(Object value) {
        return String.valueOf(value);
    }
}
`,
    },
    { path: 'pom.xml', content: pomXml({ artifact: slug(projectName), dependencies: [['io.rest-assured', 'rest-assured', VERSIONS.restAssured], ['org.testng', 'testng', VERSIONS.testng]] }) },
    { path: '.gitignore', content: 'target/\n' },
  );
  return {
    files,
    run: ['mvn test'],
    env: [['BASE_URL', 'The API under test', baseUrl || 'http://localhost:3000'], ['API_TOKEN', 'Sent as a Bearer token when set', '(none)']],
  };
}

export function apiPython(plans, { baseUrl }) {
  const names = uniqueNames(plans, (p) => snake([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `# ${c}`, line: pyLine, indent: '    ' });
    const usesJson = lines.some((l) => l.includes('json.loads'));
    const usesTime = lines.some((l) => l.includes('time.sleep'));
    return {
      path: `tests/test_${names[i]}.py`,
      content: `${usesJson ? 'import json\n' : ''}${usesTime ? 'import time\n' : ''}${usesJson || usesTime ? '\n' : ''}import requests

from support import as_text, json_path, url


def test_${names[i]}(base_url):
    """
${headerLines(plan).map((l) => `    ${l}`).join('\n')}
    """
    response = None
${lines.join('\n')}
`,
    };
  });
  files.push(
    {
      path: 'tests/support.py',
      content: `import json
import re


def url(base_url, path):
    """An absolute path in the test wins; a relative one joins BASE_URL."""
    return path if re.match(r"^https?://", path) else base_url.rstrip("/") + "/" + path.lstrip("/")


def json_path(value, path):
    """"data.items[0].id" -> the value at that path, or None."""
    for key in [k for k in re.sub(r"\\[(\\d+)\\]", r".\\1", path).split(".") if k]:
        if isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        elif isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def as_text(value):
    """Values compare as text, so "5" in a manual test matches 5 in JSON."""
    return value if isinstance(value, str) else json.dumps(value)
`,
    },
    {
      path: 'tests/conftest.py',
      content: `import os

import pytest
import requests


@pytest.fixture
def base_url():
    return os.environ.get("BASE_URL", ${q(baseUrl || 'http://localhost:3000')})


@pytest.fixture(autouse=True)
def api_token(monkeypatch):
    """API_TOKEN, when set, is sent as a Bearer token on every request."""
    token = os.environ.get("API_TOKEN")
    if token:
        original = requests.request

        def with_token(method, url, **kwargs):
            kwargs.setdefault("headers", {}).setdefault("Authorization", f"Bearer {token}")
            return original(method, url, **kwargs)

        monkeypatch.setattr(requests, "request", with_token)
`,
    },
    { path: 'pytest.ini', content: '[pytest]\ntestpaths = tests\npythonpath = tests\n' },
    { path: 'requirements.txt', content: `requests>=${VERSIONS.requests}\npytest>=${VERSIONS.pytest}\n` },
    { path: '.gitignore', content: '__pycache__/\n.pytest_cache/\n.venv/\n' },
  );
  return {
    files,
    run: ['pip install -r requirements.txt', 'pytest'],
    env: [['BASE_URL', 'The API under test', baseUrl || 'http://localhost:3000'], ['API_TOKEN', 'Sent as a Bearer token when set', '(none)']],
  };
}
