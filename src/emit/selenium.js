// Selenium WebDriver: Java (TestNG + Maven), Python (pytest) and TypeScript
// (selenium-webdriver + node:test). Tests call a small helper layer (open,
// click, type, assert…) that waits for elements, so each step stays one line.
// Every project can run through the self-healing proxy: set SELENIUM_REMOTE_URL.
import { q, body, headerLines, uniqueNames, keyConst, VERSIONS } from './common.js';
import { guessLocator } from '../locators.js';
import { slug, snake, pascal, camel } from '../model.js';

/** Any locator -> id / css / xpath, the strategies WebDriver has. */
export function seleniumLocator(target) {
  const l = target.locator ?? guessLocator(target, 'selenium');
  if (['id', 'css', 'xpath'].includes(l.strategy)) return l;
  if (l.strategy === 'testid') return { strategy: 'css', value: `[data-testid=${JSON.stringify(l.value)}]` };
  if (l.strategy === 'placeholder') return { strategy: 'css', value: `[placeholder=${JSON.stringify(l.value)}]` };
  return guessLocator({ ...target, role: l.role ?? target.role }, 'selenium');
}

const BY = {
  java: { id: 'By.id', css: 'By.cssSelector', xpath: 'By.xpath' },
  typescript: { id: 'By.id', css: 'By.css', xpath: 'By.xpath' },
  python: { id: 'By.ID', css: 'By.CSS_SELECTOR', xpath: 'By.XPATH' },
};
const by = (lang, target) => {
  const l = seleniumLocator(target);
  return lang === 'python' ? `(${BY.python[l.strategy]}, ${q(l.value)})` : `${BY[lang][l.strategy]}(${q(l.value)})`;
};

function lineFor(lang) {
  const end = lang === 'python' ? '' : ';';
  const pyName = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const call = (name, ...args) => (lang === 'python' ? `ui.${pyName(name)}(${args.join(', ')})` : lang === 'typescript' ? `await ui.${name}(${args.join(', ')})${end}` : `${name}(${args.join(', ')})${end}`);
  const todo = (text) => (lang === 'python' ? `# TODO (manual): ${text}` : `// TODO (manual): ${text}`);
  return (a) => {
    const el = a.target ? by(lang, a.target) : null;
    switch (a.type) {
      case 'goto': return call('open', q(a.url ?? '/'));
      case 'click': return call('click', el);
      case 'fill': return call('type', el, q(a.value));
      case 'select': return call('select', el, q(a.value));
      case 'check': return call('setChecked', el, lang === 'python' ? 'True' : 'true');
      case 'uncheck': return call('setChecked', el, lang === 'python' ? 'False' : 'false');
      case 'hover': return call('hover', el);
      case 'press': return el ? call('pressKey', el, keyConst(a.key, lang)) : call('pressKey', keyConst(a.key, lang));
      case 'wait': return call('pause', String(a.ms));
      case 'expectVisible': return call('assertVisible', el);
      case 'expectHidden': return call('assertHidden', el);
      case 'expectEnabled': return call('assertEnabled', el);
      case 'expectDisabled': return call('assertDisabled', el);
      case 'expectValue': return call('assertValue', el, q(a.value));
      case 'expectText': return call('assertPageContains', q(a.text));
      case 'expectUrl': return call('assertUrlContains', q(a.value));
      case 'expectTitle': return call('assertTitleContains', q(a.value));
      default: return todo('API check in a UI test: move it to the API suite');
    }
  };
}

const JAVA_BASE = `package generated;

import java.time.Duration;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

/**
 * Browser setup and the helpers generated tests call. Each helper waits for
 * its element, so tests read as one line per manual step.
 *
 * BASE_URL             the app under test
 * HEADLESS=false       show the browser
 * CHROME_ARGS          extra Chrome flags, e.g. "--no-sandbox" in containers
 * SELENIUM_REMOTE_URL  a Selenium Grid, or the self-healing proxy (http://127.0.0.1:4445)
 */
public abstract class BaseTest {
    protected WebDriver driver;
    protected WebDriverWait wait;
    protected String baseUrl;

    @BeforeMethod
    public void startBrowser() throws Exception {
        baseUrl = env("BASE_URL", "%BASE_URL%");
        ChromeOptions options = new ChromeOptions();
        if (!"false".equalsIgnoreCase(env("HEADLESS", "true"))) options.addArguments("--headless=new");
        options.addArguments("--window-size=1366,900");
        for (String arg : env("CHROME_ARGS", "").trim().split(" ")) if (!arg.isEmpty()) options.addArguments(arg);
        String remote = env("SELENIUM_REMOTE_URL", "");
        driver = remote.isEmpty() ? new ChromeDriver(options) : new RemoteWebDriver(java.net.URI.create(remote).toURL(), options);
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }

    @AfterMethod(alwaysRun = true)
    public void stopBrowser() {
        if (driver != null) driver.quit();
    }

    protected static String env(String name, String fallback) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) value = System.getProperty(name);
        return value == null || value.isEmpty() ? fallback : value;
    }

    protected void open(String path) {
        driver.get(path.matches("^https?://.*") ? path : baseUrl.replaceAll("/$", "") + (path.startsWith("/") ? path : "/" + path));
    }

    protected WebElement find(By by) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(by));
    }

    protected void click(By by) {
        wait.until(ExpectedConditions.elementToBeClickable(by)).click();
    }

    protected void type(By by, String text) {
        WebElement element = find(by);
        element.clear();
        element.sendKeys(text);
    }

    protected void select(By by, String visibleText) {
        new Select(find(by)).selectByVisibleText(visibleText);
    }

    protected void setChecked(By by, boolean checked) {
        WebElement element = wait.until(ExpectedConditions.presenceOfElementLocated(by));
        if (element.isSelected() != checked) {
            ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block: 'center'})", element);
            element.click();
        }
    }

    protected void hover(By by) {
        new Actions(driver).moveToElement(find(by)).perform();
    }

    protected void pressKey(By by, Keys key) {
        find(by).sendKeys(key);
    }

    protected void pressKey(Keys key) {
        new Actions(driver).sendKeys(key).perform();
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

    protected void assertValue(By by, String expected) {
        Assert.assertEquals(find(by).getDomProperty("value"), expected);
    }

    protected void assertPageContains(String text) {
        wait.withMessage("Expected the page to show: " + text)
            .until(d -> d.findElement(By.tagName("body")).getText().contains(text));
    }

    protected void assertUrlContains(String part) {
        wait.withMessage("Expected the URL to contain: " + part)
            .until(d -> d.getCurrentUrl().toLowerCase().contains(part.toLowerCase()));
    }

    protected void assertTitleContains(String part) {
        wait.withMessage("Expected the title to contain: " + part)
            .until(d -> d.getTitle().toLowerCase().contains(part.toLowerCase()));
    }
}
`;

const PY_SUPPORT = `"""Browser setup and the helpers generated tests call.

BASE_URL             the app under test
HEADLESS=false       show the browser
CHROME_ARGS          extra Chrome flags, e.g. "--no-sandbox" in containers
SELENIUM_REMOTE_URL  a Selenium Grid, or the self-healing proxy (http://127.0.0.1:4445)
"""
import os
import time

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait


def start_browser():
    options = webdriver.ChromeOptions()
    if os.environ.get("HEADLESS", "true").lower() != "false":
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1366,900")
    for arg in os.environ.get("CHROME_ARGS", "").split():
        options.add_argument(arg)
    remote = os.environ.get("SELENIUM_REMOTE_URL")
    return webdriver.Remote(command_executor=remote, options=options) if remote else webdriver.Chrome(options=options)


class Ui:
    """One line per manual step; every helper waits for its element."""

    def __init__(self, driver, base_url, timeout=10):
        self.driver = driver
        self.base_url = base_url.rstrip("/")
        self.wait = WebDriverWait(driver, timeout)

    def open(self, path):
        self.driver.get(path if path.startswith(("http://", "https://")) else self.base_url + "/" + path.lstrip("/"))

    def find(self, locator):
        return self.wait.until(EC.visibility_of_element_located(locator))

    def click(self, locator):
        self.wait.until(EC.element_to_be_clickable(locator)).click()

    def type(self, locator, text):
        element = self.find(locator)
        element.clear()
        element.send_keys(text)

    def select(self, locator, visible_text):
        Select(self.find(locator)).select_by_visible_text(visible_text)

    def set_checked(self, locator, checked):
        element = self.wait.until(EC.presence_of_element_located(locator))
        if element.is_selected() != checked:
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'})", element)
            element.click()

    def hover(self, locator):
        ActionChains(self.driver).move_to_element(self.find(locator)).perform()

    def press_key(self, locator_or_key, key=None):
        if key is None:
            ActionChains(self.driver).send_keys(locator_or_key).perform()
        else:
            self.find(locator_or_key).send_keys(key)

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

    def assert_value(self, locator, expected):
        assert self.find(locator).get_property("value") == expected

    def assert_page_contains(self, text):
        self.wait.until(lambda d: text in d.find_element(By.TAG_NAME, "body").text, f"Expected the page to show: {text}")

    def assert_url_contains(self, part):
        self.wait.until(lambda d: part.lower() in d.current_url.lower(), f"Expected the URL to contain: {part}")

    def assert_title_contains(self, part):
        self.wait.until(lambda d: part.lower() in d.title.lower(), f"Expected the title to contain: {part}")
`;

const TS_SUPPORT = `// Browser setup and the helpers generated tests call. Each helper waits for
// its element, so tests read as one line per manual step.
//
// BASE_URL             the app under test
// HEADLESS=false       show the browser
// CHROME_ARGS          extra Chrome flags, e.g. "--no-sandbox" in containers
// SELENIUM_REMOTE_URL  a Selenium Grid, or the self-healing proxy (http://127.0.0.1:4445)
import assert from 'node:assert/strict';
import { Builder, By, Key, until, type Locator, type WebDriver, type WebElement } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const TIMEOUT = 10_000;

export class Ui {
  constructor(readonly driver: WebDriver, readonly baseUrl: string) {}

  static async start(): Promise<Ui> {
    const options = new chrome.Options().addArguments('--window-size=1366,900', ...(process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean));
    if ((process.env.HEADLESS ?? 'true').toLowerCase() !== 'false') options.addArguments('--headless=new');
    let builder = new Builder().forBrowser('chrome').setChromeOptions(options);
    if (process.env.SELENIUM_REMOTE_URL) builder = builder.usingServer(process.env.SELENIUM_REMOTE_URL);
    return new Ui(await builder.build(), (process.env.BASE_URL ?? '%BASE_URL%').replace(/\\/$/, ''));
  }

  quit() {
    return this.driver.quit();
  }

  open(path: string) {
    return this.driver.get(/^https?:\\/\\//.test(path) ? path : this.baseUrl + '/' + path.replace(/^\\//, ''));
  }

  async find(locator: Locator): Promise<WebElement> {
    const element = await this.driver.wait(until.elementLocated(locator), TIMEOUT, \`Not found: \${locator}\`);
    await this.driver.wait(until.elementIsVisible(element), TIMEOUT, \`Not visible: \${locator}\`);
    return element;
  }

  async click(locator: Locator) {
    const element = await this.find(locator);
    await this.driver.wait(until.elementIsEnabled(element), TIMEOUT);
    await element.click();
  }

  async type(locator: Locator, text: string) {
    const element = await this.find(locator);
    await element.clear();
    await element.sendKeys(text);
  }

  async select(locator: Locator, visibleText: string) {
    const element = await this.find(locator);
    await element.findElement(By.xpath(\`.//option[normalize-space()=\${JSON.stringify(visibleText)}]\`)).click();
  }

  async setChecked(locator: Locator, checked: boolean) {
    const element = await this.driver.wait(until.elementLocated(locator), TIMEOUT);
    if ((await element.isSelected()) !== checked) {
      await this.driver.executeScript("arguments[0].scrollIntoView({block: 'center'})", element);
      await element.click();
    }
  }

  async hover(locator: Locator) {
    await this.driver.actions().move({ origin: await this.find(locator) }).perform();
  }

  async pressKey(locatorOrKey: Locator | string, key?: string) {
    if (key === undefined) await this.driver.actions().sendKeys(locatorOrKey as string).perform();
    else await (await this.find(locatorOrKey as Locator)).sendKeys(key);
  }

  pause(millis: number) {
    return this.driver.sleep(millis);
  }

  async assertVisible(locator: Locator) {
    assert.ok(await (await this.find(locator)).isDisplayed(), \`Expected visible: \${locator}\`);
  }

  async assertHidden(locator: Locator) {
    await this.driver.wait(async () => {
      const found = await this.driver.findElements(locator);
      return found.length === 0 || !(await found[0].isDisplayed().catch(() => false));
    }, TIMEOUT, \`Expected hidden: \${locator}\`);
  }

  async assertEnabled(locator: Locator) {
    assert.ok(await (await this.find(locator)).isEnabled(), \`Expected enabled: \${locator}\`);
  }

  async assertDisabled(locator: Locator) {
    assert.ok(!(await (await this.find(locator)).isEnabled()), \`Expected disabled: \${locator}\`);
  }

  async assertValue(locator: Locator, expected: string) {
    assert.equal(await (await this.find(locator)).getAttribute('value'), expected);
  }

  async assertPageContains(text: string) {
    await this.driver.wait(async () => (await this.driver.findElement(By.css('body')).getText()).includes(text), TIMEOUT, \`Expected the page to show: \${text}\`);
  }

  async assertUrlContains(part: string) {
    await this.driver.wait(async () => (await this.driver.getCurrentUrl()).toLowerCase().includes(part.toLowerCase()), TIMEOUT, \`Expected the URL to contain: \${part}\`);
  }

  async assertTitleContains(part: string) {
    await this.driver.wait(async () => (await this.driver.getTitle()).toLowerCase().includes(part.toLowerCase()), TIMEOUT, \`Expected the title to contain: \${part}\`);
  }
}

export { By, Key };
`;

export function pomXml({ artifact, dependencies }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>generated</groupId>
  <artifactId>${artifact}</artifactId>
  <version>1.0.0</version>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencies>
${dependencies.map(([g, a, v]) => `    <dependency>
      <groupId>${g}</groupId>
      <artifactId>${a}</artifactId>
      <version>${v}</version>
      <scope>test</scope>
    </dependency>`).join('\n')}
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>${VERSIONS.surefire}</version>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

export function seleniumJava(plans, { baseUrl, projectName }) {
  const names = uniqueNames(plans, (p) => pascal([p.test.id, p.test.title].filter(Boolean).join(' '), 50));
  const line = lineFor('java');
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line, indent: '        ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    const imports = ['org.openqa.selenium.By', ...(lines.some((l) => l.includes('Keys.')) ? ['org.openqa.selenium.Keys'] : []), 'org.testng.annotations.Test'];
    return {
      path: `src/test/java/generated/${names[i]}Test.java`,
      content: `package generated;

${imports.map((x) => `import ${x};`).join('\n')}

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
    { path: 'src/test/java/generated/BaseTest.java', content: JAVA_BASE.replace('%BASE_URL%', baseUrl || 'http://localhost:3000') },
    { path: 'pom.xml', content: pomXml({ artifact: slug(projectName), dependencies: [['org.seleniumhq.selenium', 'selenium-java', VERSIONS.seleniumJava], ['org.testng', 'testng', VERSIONS.testng]] }) },
    { path: '.gitignore', content: 'target/\n' },
  );
  return {
    files,
    run: ['mvn test', 'mvn test -Dtest=ClassNameTest   (one class)'],
    env: [['BASE_URL', 'The app under test', baseUrl || 'http://localhost:3000'], ['HEADLESS', 'false to watch the browser', 'true'], ['SELENIUM_REMOTE_URL', 'Grid or self-healing proxy', '(local Chrome)']],
  };
}

export function seleniumPython(plans, { baseUrl }) {
  const names = uniqueNames(plans, (p) => snake([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const line = lineFor('python');
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `# ${c}`, line, indent: '    ' });
    const usesKeys = lines.some((l) => l.includes('Keys.'));
    return {
      path: `tests/test_${names[i]}.py`,
      content: `from selenium.webdriver.common.by import By
${usesKeys ? 'from selenium.webdriver.common.keys import Keys\n' : ''}

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
    {
      path: 'tests/conftest.py',
      content: `import os

import pytest

from support import Ui, start_browser


@pytest.fixture
def ui():
    driver = start_browser()
    try:
        yield Ui(driver, os.environ.get("BASE_URL", ${q(baseUrl || 'http://localhost:3000')}))
    finally:
        driver.quit()
`,
    },
    { path: 'pytest.ini', content: '[pytest]\ntestpaths = tests\npythonpath = tests\n' },
    { path: 'requirements.txt', content: `selenium>=${VERSIONS.seleniumPy}\npytest>=${VERSIONS.pytest}\n` },
    { path: '.gitignore', content: '__pycache__/\n.pytest_cache/\n.venv/\n' },
  );
  return {
    files,
    run: ['python -m venv .venv && .venv\\Scripts\\activate   (macOS/Linux: source .venv/bin/activate)', 'pip install -r requirements.txt', 'pytest'],
    env: [['BASE_URL', 'The app under test', baseUrl || 'http://localhost:3000'], ['HEADLESS', 'false to watch the browser', 'true'], ['SELENIUM_REMOTE_URL', 'Grid or self-healing proxy', '(local Chrome)']],
  };
}

export function seleniumTypescript(plans, { baseUrl, projectName }) {
  const names = uniqueNames(plans, (p) => slug([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const line = lineFor('typescript');
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line, indent: '    ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    const usesKey = lines.some((l) => l.includes('Key.'));
    return {
      path: `tests/${names[i]}.test.ts`,
      content: `import { test } from 'node:test';
import { Ui, By${usesKey ? ', Key' : ''} } from '../support/ui.ts';

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
test(${q(title)}, async () => {
  const ui = await Ui.start();
  try {
${lines.join('\n')}
  } finally {
    await ui.quit();
  }
});
`,
    };
  });
  files.push(
    { path: 'support/ui.ts', content: TS_SUPPORT.replace('%BASE_URL%', baseUrl || 'http://localhost:3000') },
    { path: 'package.json', content: JSON.stringify({ name: slug(projectName), private: true, type: 'module', scripts: { test: 'node --import tsx --test --test-concurrency=1 "tests/*.test.ts"' }, devDependencies: { 'selenium-webdriver': VERSIONS.seleniumNpm, tsx: VERSIONS.tsx, '@types/selenium-webdriver': '^4.35.7' } }, null, 2) + '\n' },
    { path: '.gitignore', content: 'node_modules/\n' },
  );
  return {
    files,
    run: ['npm install', 'npm test'],
    env: [['BASE_URL', 'The app under test', baseUrl || 'http://localhost:3000'], ['HEADLESS', 'false to watch the browser', 'true'], ['SELENIUM_REMOTE_URL', 'Grid or self-healing proxy', '(local Chrome)']],
  };
}
