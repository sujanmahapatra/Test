// Appium (native Android / iOS): Java (java-client + TestNG), Python
// (Appium-Python-Client + pytest) and TypeScript (WebdriverIO). There is no
// device to explore, so element locators come from the step text and are all
// marked TODO; accessibility ids are used when a step names one, and an
// XPath over the text attributes Android and iOS expose otherwise.
import { q, body, headerLines, uniqueNames, VERSIONS } from './common.js';
import { pomXml } from './selenium.js';
import { slug, snake, pascal, camel } from '../model.js';

const xq = (s) => (!s.includes("'") ? `'${s}'` : !s.includes('"') ? `"${s}"` : `concat('${s.split("'").join(`', "'", '`)}')`);

/** accessibilityId for id-like names ("loginButton", "email_input"); text XPath for words. */
export function mobileLocator(target) {
  // A locator someone confirmed on a device is kept; a guess is rebuilt the same way for every element.
  const l = target.locator;
  if (l && target.resolved && ['accessibilityId', 'id', 'xpath'].includes(l.strategy)) return l;
  const name = target.description;
  if (/^[\w.:/-]+$/.test(name) && /[A-Z_:/.-]/.test(name.slice(1))) return { strategy: 'accessibilityId', value: name };
  const attrs = ['@text', '@content-desc', '@hint', '@label', '@name', '@value'].map((a) => `${a}=${xq(name)}`).join(' or ');
  return { strategy: 'xpath', value: `//*[${attrs}]` };
}
const textXpath = (text) => `//*[${['@text', '@content-desc', '@label', '@name', '@value'].map((a) => `contains(${a}, ${xq(text)})`).join(' or ')}]`;

const BY = {
  java: { accessibilityId: 'AppiumBy.accessibilityId', id: 'AppiumBy.id', xpath: 'AppiumBy.xpath' },
  python: { accessibilityId: 'AppiumBy.ACCESSIBILITY_ID', id: 'AppiumBy.ID', xpath: 'AppiumBy.XPATH' },
};
function locate(lang, target) {
  const l = mobileLocator(target);
  if (lang === 'python') return `(${BY.python[l.strategy]}, ${q(l.value)})`;
  if (lang === 'java') return `${BY.java[l.strategy]}(${q(l.value)})`;
  // WebdriverIO selector strings
  if (l.strategy === 'accessibilityId') return q(`~${l.value}`);
  if (l.strategy === 'id') return q(`id=${l.value}`);
  return q(l.value);
}

function lineFor(lang) {
  const todo = (text) => (lang === 'python' ? `# TODO (manual): ${text}` : `// TODO (manual): ${text}`);
  if (lang === 'typescript') {
    return (a) => {
      const el = a.target ? `$(${locate(lang, a.target)})` : null;
      switch (a.type) {
        case 'goto': return a.url && /^https?:/.test(a.url) ? `await driver.url(${q(a.url)});` : '// The app is launched by the session capabilities (wdio.conf.ts)';
        case 'click': case 'check': case 'uncheck': return `await ${el}.click();`;
        case 'fill': return `await ${el}.setValue(${q(a.value)});`;
        case 'select': return [`await ${el}.click();`, `await $(${q(textXpath(a.value))}).click();`];
        case 'expectVisible': return `await expect(${el}).toBeDisplayed();`;
        case 'expectHidden': return `await expect(${el}).not.toBeDisplayed();`;
        case 'expectEnabled': return `await expect(${el}).toBeEnabled();`;
        case 'expectDisabled': return `await expect(${el}).toBeDisabled();`;
        case 'expectValue': return `await expect(${el}).toHaveText(${q(a.value)});`;
        case 'expectText': return `await expect($(${q(textXpath(a.text))})).toBeDisplayed();`;
        case 'wait': return `await driver.pause(${a.ms});`;
        default: return todo(`no ${a.type} gesture in the generated mobile helpers`);
      }
    };
  }
  const end = lang === 'python' ? '' : ';';
  const call = (name, ...args) => (lang === 'python' ? `ui.${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}(${args.join(', ')})` : `${name}(${args.join(', ')})${end}`);
  const byText = (text) => (lang === 'python' ? `(AppiumBy.XPATH, ${q(textXpath(text))})` : `AppiumBy.xpath(${q(textXpath(text))})`);
  return (a) => {
    const el = a.target ? locate(lang, a.target) : null;
    switch (a.type) {
      case 'goto': return lang === 'python' ? '# The app is launched by the session capabilities (conftest.py)' : '// The app is launched by the session capabilities (BaseTest)';
      case 'click': case 'check': case 'uncheck': return call('tap', el);
      case 'fill': return call('type', el, q(a.value));
      case 'select': return [call('tap', el), call('tap', byText(a.value))];
      case 'wait': return call('pause', String(a.ms));
      case 'expectVisible': return call('assertVisible', el);
      case 'expectHidden': return call('assertHidden', el);
      case 'expectEnabled': return call('assertEnabled', el);
      case 'expectDisabled': return call('assertDisabled', el);
      case 'expectValue': return call('assertText', el, q(a.value));
      case 'expectText': return call('assertVisible', byText(a.text));
      default: return todo(`no ${a.type} gesture in the generated mobile helpers`);
    }
  };
}

// Every mobile locator is a guess until checked on a device, so the body()
// helper adds its TODO under each one.
const unresolved = (plan) => ({ ...plan, actions: plan.actions.map((a) => (a.target ? { ...a, target: { ...a.target, locator: mobileLocator(a.target), resolved: false } } : a)) });

const JAVA_BASE = `package generated;

import io.appium.java_client.AppiumBy;
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.android.AndroidDriver;
import io.appium.java_client.android.options.UiAutomator2Options;
import io.appium.java_client.ios.IOSDriver;
import io.appium.java_client.ios.options.XCUITestOptions;
import java.net.URI;
import java.net.URL;
import java.time.Duration;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

/**
 * Appium session setup and the helpers generated tests call.
 *
 * APPIUM_URL     Appium server (default http://127.0.0.1:4723)
 * PLATFORM_NAME  Android (default) or iOS
 * DEVICE_NAME    emulator / simulator / device name
 * APP            path or URL of the .apk / .app / .ipa to install
 * APP_PACKAGE, APP_ACTIVITY   (Android) start an installed app instead
 * BUNDLE_ID                   (iOS) start an installed app instead
 */
public abstract class BaseTest {
    protected AppiumDriver driver;
    protected WebDriverWait wait;

    @BeforeMethod
    public void startSession() throws Exception {
        URL server = URI.create(env("APPIUM_URL", "http://127.0.0.1:4723")).toURL();
        if ("ios".equalsIgnoreCase(env("PLATFORM_NAME", "Android"))) {
            XCUITestOptions options = new XCUITestOptions().setDeviceName(env("DEVICE_NAME", "iPhone 16"));
            if (!env("APP", "").isEmpty()) options.setApp(env("APP", ""));
            if (!env("BUNDLE_ID", "").isEmpty()) options.setBundleId(env("BUNDLE_ID", ""));
            driver = new IOSDriver(server, options);
        } else {
            UiAutomator2Options options = new UiAutomator2Options().setDeviceName(env("DEVICE_NAME", "Android Emulator"));
            if (!env("APP", "").isEmpty()) options.setApp(env("APP", ""));
            if (!env("APP_PACKAGE", "").isEmpty()) options.setAppPackage(env("APP_PACKAGE", "")).setAppActivity(env("APP_ACTIVITY", ""));
            driver = new AndroidDriver(server, options);
        }
        wait = new WebDriverWait(driver, Duration.ofSeconds(15));
    }

    @AfterMethod(alwaysRun = true)
    public void stopSession() {
        if (driver != null) driver.quit();
    }

    protected static String env(String name, String fallback) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) value = System.getProperty(name);
        return value == null || value.isEmpty() ? fallback : value;
    }

    protected WebElement find(By by) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(by));
    }

    protected void tap(By by) {
        wait.until(ExpectedConditions.elementToBeClickable(by)).click();
    }

    protected void type(By by, String text) {
        WebElement element = find(by);
        element.clear();
        element.sendKeys(text);
    }

    protected void pause(long millis) throws InterruptedException {
        Thread.sleep(millis);
    }

    protected void assertVisible(By by) {
        Assert.assertTrue(find(by).isDisplayed(), "Expected visible: " + by);
    }

    protected void assertHidden(By by) {
        Assert.assertTrue(wait.until(ExpectedConditions.invisibilityOfElementLocated(by)), "Expected hidden: " + by);
    }

    protected void assertEnabled(By by) {
        Assert.assertTrue(find(by).isEnabled(), "Expected enabled: " + by);
    }

    protected void assertDisabled(By by) {
        Assert.assertFalse(find(by).isEnabled(), "Expected disabled: " + by);
    }

    protected void assertText(By by, String expected) {
        Assert.assertEquals(find(by).getText(), expected);
    }

    // Keeps the AppiumBy import used in BaseTest for subclasses that need it.
    protected static By accessibilityId(String id) {
        return AppiumBy.accessibilityId(id);
    }
}
`;

const PY_SUPPORT = `"""Appium session setup and the helpers generated tests call.

APPIUM_URL     Appium server (default http://127.0.0.1:4723)
PLATFORM_NAME  Android (default) or iOS
DEVICE_NAME    emulator / simulator / device name
APP            path or URL of the .apk / .app / .ipa to install
APP_PACKAGE, APP_ACTIVITY   (Android) start an installed app instead
BUNDLE_ID                   (iOS) start an installed app instead
"""
import os
import time

from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.options.ios import XCUITestOptions
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def start_session():
    if os.environ.get("PLATFORM_NAME", "Android").lower() == "ios":
        options = XCUITestOptions()
        options.device_name = os.environ.get("DEVICE_NAME", "iPhone 16")
        if os.environ.get("BUNDLE_ID"):
            options.bundle_id = os.environ["BUNDLE_ID"]
    else:
        options = UiAutomator2Options()
        options.device_name = os.environ.get("DEVICE_NAME", "Android Emulator")
        if os.environ.get("APP_PACKAGE"):
            options.app_package = os.environ["APP_PACKAGE"]
            options.app_activity = os.environ.get("APP_ACTIVITY", "")
    if os.environ.get("APP"):
        options.app = os.environ["APP"]
    return webdriver.Remote(os.environ.get("APPIUM_URL", "http://127.0.0.1:4723"), options=options)


class Ui:
    """One line per manual step; every helper waits for its element."""

    def __init__(self, driver, timeout=15):
        self.driver = driver
        self.wait = WebDriverWait(driver, timeout)

    def find(self, locator):
        return self.wait.until(EC.visibility_of_element_located(locator))

    def tap(self, locator):
        self.wait.until(EC.element_to_be_clickable(locator)).click()

    def type(self, locator, text):
        element = self.find(locator)
        element.clear()
        element.send_keys(text)

    def pause(self, millis):
        time.sleep(millis / 1000)

    def assert_visible(self, locator):
        assert self.find(locator).is_displayed(), f"Expected visible: {locator}"

    def assert_hidden(self, locator):
        assert self.wait.until(EC.invisibility_of_element_located(locator)), f"Expected hidden: {locator}"

    def assert_enabled(self, locator):
        assert self.find(locator).is_enabled(), f"Expected enabled: {locator}"

    def assert_disabled(self, locator):
        assert not self.find(locator).is_enabled(), f"Expected disabled: {locator}"

    def assert_text(self, locator, expected):
        assert self.find(locator).text == expected
`;

const ENV = [
  ['APPIUM_URL', 'Appium server', 'http://127.0.0.1:4723'],
  ['PLATFORM_NAME', 'Android or iOS', 'Android'],
  ['DEVICE_NAME', 'Emulator, simulator or device', 'Android Emulator'],
  ['APP', 'Path or URL of the app build to install', '(none)'],
  ['APP_PACKAGE / APP_ACTIVITY', 'Start an installed Android app', '(none)'],
  ['BUNDLE_ID', 'Start an installed iOS app', '(none)'],
];

export function appiumJava(plans, { projectName }) {
  const names = uniqueNames(plans, (p) => pascal([p.test.id, p.test.title].filter(Boolean).join(' '), 50));
  const line = lineFor('java');
  const files = plans.map(unresolved).map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line, indent: '        ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    return {
      path: `src/test/java/generated/${names[i]}Test.java`,
      content: `package generated;

import io.appium.java_client.AppiumBy;
import org.testng.annotations.Test;

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
public class ${names[i]}Test extends BaseTest {

    @Test(description = ${q(title)})
    public void ${camel(names[i])}() throws Exception {
${lines.join('\n')}
    }
}
`,
    };
  });
  files.push(
    { path: 'src/test/java/generated/BaseTest.java', content: JAVA_BASE },
    { path: 'pom.xml', content: pomXml({ artifact: slug(projectName), dependencies: [['io.appium', 'java-client', VERSIONS.appiumJava], ['org.seleniumhq.selenium', 'selenium-support', VERSIONS.seleniumJava], ['org.testng', 'testng', VERSIONS.testng]] }) },
    { path: '.gitignore', content: 'target/\n' },
  );
  return { files, run: ['appium   (in another terminal; install with: npm i -g appium && appium driver install uiautomator2)', 'mvn test'], env: ENV };
}

export function appiumPython(plans) {
  const names = uniqueNames(plans, (p) => snake([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const line = lineFor('python');
  const files = plans.map(unresolved).map((plan, i) => {
    const lines = body(plan, { comment: (c) => `# ${c}`, line, indent: '    ' });
    return {
      path: `tests/test_${names[i]}.py`,
      content: `from appium.webdriver.common.appiumby import AppiumBy


def test_${names[i]}(ui):
    """
${headerLines(plan).map((l) => `    ${l}`).join('\n')}
    """
${lines.join('\n')}
`,
    };
  });
  files.push(
    { path: 'tests/support.py', content: PY_SUPPORT },
    { path: 'tests/conftest.py', content: `import pytest\n\nfrom support import Ui, start_session\n\n\n@pytest.fixture\ndef ui():\n    driver = start_session()\n    try:\n        yield Ui(driver)\n    finally:\n        driver.quit()\n` },
    { path: 'pytest.ini', content: '[pytest]\ntestpaths = tests\npythonpath = tests\n' },
    { path: 'requirements.txt', content: `Appium-Python-Client>=${VERSIONS.appiumPy}\npytest>=${VERSIONS.pytest}\n` },
    { path: '.gitignore', content: '__pycache__/\n.pytest_cache/\n.venv/\n' },
  );
  return { files, run: ['appium   (in another terminal)', 'pip install -r requirements.txt', 'pytest'], env: ENV };
}

export function appiumTypescript(plans, { projectName }) {
  const names = uniqueNames(plans, (p) => slug([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const line = lineFor('typescript');
  const files = plans.map(unresolved).map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line, indent: '    ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    return {
      path: `test/specs/${names[i]}.e2e.ts`,
      content: `import { $, driver, expect } from '@wdio/globals';

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
describe(${q(title)}, () => {
  it(${q(plan.test.title)}, async () => {
${lines.join('\n')}
  });
});
`,
    };
  });
  files.push(
    {
      path: 'wdio.conf.ts',
      content: `// Appium settings come from the environment; see README.md.
const server = new URL(process.env.APPIUM_URL ?? 'http://127.0.0.1:4723');
const ios = (process.env.PLATFORM_NAME ?? 'Android').toLowerCase() === 'ios';

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: server.hostname,
  port: Number(server.port || 4723),
  path: server.pathname === '/' ? '/' : server.pathname,
  specs: ['./test/specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [{
    platformName: ios ? 'iOS' : 'Android',
    'appium:automationName': ios ? 'XCUITest' : 'UiAutomator2',
    'appium:deviceName': process.env.DEVICE_NAME ?? (ios ? 'iPhone 16' : 'Android Emulator'),
    ...(process.env.APP ? { 'appium:app': process.env.APP } : {}),
    ...(process.env.APP_PACKAGE ? { 'appium:appPackage': process.env.APP_PACKAGE, 'appium:appActivity': process.env.APP_ACTIVITY } : {}),
    ...(process.env.BUNDLE_ID ? { 'appium:bundleId': process.env.BUNDLE_ID } : {}),
  }],
  logLevel: 'warn',
  waitforTimeout: 15_000,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
};
`,
    },
    {
      path: 'package.json',
      content: JSON.stringify({
        name: slug(projectName), private: true, type: 'module', scripts: { test: 'wdio run ./wdio.conf.ts' },
        devDependencies: { '@wdio/cli': VERSIONS.wdio, '@wdio/globals': VERSIONS.wdio, '@wdio/local-runner': VERSIONS.wdio, '@wdio/mocha-framework': VERSIONS.wdio, '@wdio/spec-reporter': VERSIONS.wdio, tsx: VERSIONS.tsx },
      }, null, 2) + '\n',
    },
    { path: 'tsconfig.json', content: JSON.stringify({ compilerOptions: { target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext', types: ['node', '@wdio/globals/types', '@wdio/mocha-framework'], skipLibCheck: true, noEmit: true } }, null, 2) + '\n' },
    { path: '.gitignore', content: 'node_modules/\n' },
  );
  return { files, run: ['appium   (in another terminal)', 'npm install', 'npm test'], env: ENV };
}
