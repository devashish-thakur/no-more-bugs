// Detect the project's stacks and propose test suites for .nomorebugs/config.json.
// Detection is a starting point: the agent (or you) should check the commands once.
import fs from 'node:fs';
import path from 'node:path';
import { readText, readJson } from './util.mjs';

const R = '.nomorebugs/local/reports';
const isWin = process.platform === 'win32';

const exists = (root, p) => fs.existsSync(path.join(root, p));
const dirExists = (root, p) => {
  try {
    return fs.statSync(path.join(root, p)).isDirectory();
  } catch {
    return false;
  }
};

function firstDir(root, dirs) {
  return dirs.filter((d) => dirExists(root, d));
}

export function detectProject(root) {
  const suites = [];
  const notes = [];
  const source = new Set();
  const tests = new Set();
  const stacks = new Set();

  // ---------- JavaScript / TypeScript ----------
  const pkg = exists(root, 'package.json') ? readJson(path.join(root, 'package.json'), {}) : null;
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const testScript = pkg.scripts?.test || '';
    const ts = !!deps.typescript || exists(root, 'tsconfig.json');
    const stack = ts ? 'typescript' : 'javascript';
    const dirs = firstDir(root, ['src', 'lib', 'app', 'server', 'packages']);
    if (dirs.length) dirs.forEach((d) => source.add(`${d}/**`));
    else source.add('**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}');
    ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', 'tests/**', 'test/**', 'e2e/**'].forEach((t) => tests.add(t));

    if (deps.vitest) {
      stacks.add(stack);
      suites.push({
        name: 'unit',
        stack,
        command: `npx vitest run --reporter=default --reporter=junit --outputFile.junit=${R}/vitest.xml`,
        reports: [`${R}/vitest.xml`],
        format: 'junit',
      });
    } else if (deps.jest || /\bjest\b/.test(testScript)) {
      stacks.add(stack);
      suites.push({
        name: 'unit',
        stack,
        command: 'npx jest --ci --reporters=default --reporters=jest-junit',
        env: { JEST_JUNIT_OUTPUT_DIR: R, JEST_JUNIT_OUTPUT_NAME: 'jest.xml', JEST_JUNIT_ADD_FILE_ATTRIBUTE: 'true' },
        reports: [`${R}/jest.xml`],
        format: 'junit',
      });
      if (!deps['jest-junit']) notes.push('Jest needs the jest-junit reporter to write reports: npm install --save-dev jest-junit');
    } else if (/node\s+--test/.test(testScript)) {
      stacks.add(stack);
      suites.push({
        name: 'unit',
        stack,
        command: `node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=${R}/node.xml`,
        reports: [`${R}/node.xml`],
        format: 'junit',
      });
    }
    if (deps['@playwright/test']) {
      stacks.add(stack);
      suites.push({
        name: 'e2e',
        stack,
        command: 'npx playwright test --reporter=line,junit',
        env: { PLAYWRIGHT_JUNIT_OUTPUT_FILE: `${R}/playwright.xml` },
        reports: [`${R}/playwright.xml`],
        format: 'junit',
      });
    }
  }

  // ---------- Python ----------
  const pyMarkers = ['pytest.ini', 'pyproject.toml', 'setup.cfg', 'tox.ini', 'conftest.py', 'requirements.txt', 'requirements-dev.txt', 'Pipfile'];
  const pyText = pyMarkers.map((m) => readText(path.join(root, m), '')).join('\n');
  if (/pytest/.test(pyText) || exists(root, 'conftest.py') || exists(root, 'pytest.ini')) {
    stacks.add('python');
    let runner;
    if (exists(root, 'uv.lock')) runner = 'uv run pytest';
    else if (exists(root, 'poetry.lock')) runner = 'poetry run pytest';
    else if (exists(root, '.venv')) runner = isWin ? '.venv\\Scripts\\python -m pytest' : '.venv/bin/python -m pytest';
    else runner = isWin ? 'python -m pytest' : 'python3 -m pytest';
    suites.push({
      name: suites.some((s) => s.name === 'unit') ? 'python' : 'unit',
      stack: 'python',
      command: `${runner} --junitxml=${R}/pytest.xml -o junit_family=xunit1`,
      reports: [`${R}/pytest.xml`],
      format: 'junit',
    });
    const dirs = firstDir(root, ['src', 'app']);
    const pkgName = (/^name\s*=\s*["']([^"']+)/m.exec(readText(path.join(root, 'pyproject.toml'), '')) || [])[1];
    if (dirs.length) dirs.forEach((d) => source.add(`${d}/**/*.py`));
    else if (pkgName && dirExists(root, pkgName.replace(/-/g, '_'))) source.add(`${pkgName.replace(/-/g, '_')}/**/*.py`);
    else source.add('**/*.py');
    ['tests/**', 'test/**', '**/test_*.py', '**/*_test.py', '**/conftest.py'].forEach((t) => tests.add(t));
  }

  // ---------- Java / Kotlin ----------
  if (exists(root, 'pom.xml')) {
    stacks.add('java');
    const mvn = exists(root, 'mvnw') ? (isWin ? 'mvnw.cmd' : './mvnw') : 'mvn';
    suites.push({
      name: 'jvm',
      stack: 'java',
      command: { default: `${exists(root, 'mvnw') ? './mvnw' : 'mvn'} -q test`, windows: `${mvn} -q test` },
      reports: ['target/surefire-reports/TEST-*.xml', '**/target/surefire-reports/TEST-*.xml'],
      format: 'junit',
    });
  } else if (exists(root, 'build.gradle') || exists(root, 'build.gradle.kts')) {
    stacks.add(exists(root, 'build.gradle.kts') ? 'kotlin' : 'java');
    const wrapper = exists(root, 'gradlew');
    suites.push({
      name: 'jvm',
      stack: exists(root, 'build.gradle.kts') ? 'kotlin' : 'java',
      command: { default: `${wrapper ? './gradlew' : 'gradle'} test`, windows: `${wrapper ? 'gradlew.bat' : 'gradle'} test` },
      reports: ['build/test-results/**/*.xml', '**/build/test-results/**/*.xml'],
      format: 'junit',
    });
  }
  if (stacks.has('java') || stacks.has('kotlin')) {
    source.add('**/src/main/**');
    ['**/src/test/**', '**/src/androidTest/**'].forEach((t) => tests.add(t));
  }

  // ---------- Dart / Flutter ----------
  const pubspec = readText(path.join(root, 'pubspec.yaml'));
  if (pubspec != null) {
    const flutter = /^\s*flutter\s*:/m.test(pubspec) || /sdk:\s*flutter/.test(pubspec);
    stacks.add(flutter ? 'flutter' : 'dart');
    suites.push({
      name: flutter ? 'flutter' : 'dart',
      stack: flutter ? 'flutter' : 'dart',
      command: `${flutter ? 'flutter' : 'dart'} test --file-reporter json:${R}/dart.json`,
      reports: [`${R}/dart.json`],
      format: 'dart-json',
    });
    source.add('lib/**');
    ['test/**', 'integration_test/**'].forEach((t) => tests.add(t));
  }

  // ---------- Unity ----------
  const unityVersion = readText(path.join(root, 'ProjectSettings', 'ProjectVersion.txt'));
  if (unityVersion != null && dirExists(root, 'Assets')) {
    stacks.add('unity');
    const version = (/m_EditorVersion:\s*(\S+)/.exec(unityVersion) || [])[1];
    const editor = guessUnityEditor(version);
    const exe = editor ? `"${editor}"` : '"%UNITY_EDITOR%"';
    const unixExe = editor ? `"${editor}"` : '"$UNITY_EDITOR"';
    for (const platform of ['EditMode', 'PlayMode']) {
      const args = `-batchmode -nographics -projectPath . -runTests -testPlatform ${platform} -testResults ${R}/unity-${platform.toLowerCase()}.xml -logFile ${R}/unity-${platform.toLowerCase()}.log`;
      suites.push({
        name: `unity-${platform.toLowerCase()}`,
        stack: 'unity',
        command: { default: `${unixExe} ${args}`, windows: `${exe} ${args}` },
        reports: [`${R}/unity-${platform.toLowerCase()}.xml`],
        format: 'nunit',
      });
    }
    notes.push(
      editor
        ? `Unity: using the editor at ${editor}. Batch mode can't run while this project is open in the Unity editor.`
        : `Unity ${version || ''}: couldn't find the editor. Set UNITY_EDITOR to the editor's path, or edit the suite commands. Batch mode can't run while this project is open in the Unity editor.`,
    );
    source.add('Assets/**/*.cs');
    ['Assets/**/Tests/**', 'Assets/**/*Tests.cs', 'Assets/**/*Test.cs'].forEach((t) => tests.add(t));
  }

  // ---------- Godot ----------
  if (exists(root, 'project.godot')) {
    stacks.add('godot');
    const godot = process.env.GODOT_BIN || process.env.GODOT || 'godot';
    if (dirExists(root, 'addons/gut')) {
      suites.push({
        name: 'godot',
        stack: 'godot',
        command: `${godot} --headless -s addons/gut/gut_cmdln.gd -gdir=res://test -ginclude_subdirs -gexit -gjunit_xml_file=res://${R}/gut.xml`,
        reports: [`${R}/gut.xml`],
        format: 'junit',
      });
    } else if (dirExists(root, 'addons/gdUnit4')) {
      suites.push({
        name: 'godot',
        stack: 'godot',
        command: { default: 'addons/gdUnit4/runtest.sh -a res://test', windows: 'addons\\gdUnit4\\runtest.cmd -a res://test' },
        env: { GODOT_BIN: godot },
        reports: ['reports/**/results.xml'],
        format: 'junit',
      });
    } else {
      notes.push('Godot: no GUT or gdUnit4 addon found. Install one of them, then run nmb init --force.');
    }
    source.add('**/*.gd');
    ['test/**', 'tests/**', '**/test_*.gd', '**/*_test.gd'].forEach((t) => tests.add(t));
  }

  // ---------- .NET (not Unity) ----------
  if (!stacks.has('unity')) {
    const entries = safeList(root);
    if (entries.some((f) => /\.(sln|slnx|csproj|fsproj)$/.test(f)) || entries.some((d) => dirExists(root, d) && safeList(path.join(root, d)).some((f) => /\.csproj$/.test(f)))) {
      stacks.add('dotnet');
      suites.push({
        name: 'dotnet',
        stack: 'dotnet',
        command: `dotnet test --logger "trx;LogFilePrefix=nmb" --results-directory ${R}/dotnet`,
        reports: [`${R}/dotnet/*.trx`],
        format: 'trx',
      });
      source.add('**/*.cs');
      ['**/*Tests/**', '**/*.Tests/**', '**/*Test.cs', '**/*Tests.cs'].forEach((t) => tests.add(t));
    }
  }

  // ---------- Go ----------
  if (exists(root, 'go.mod')) {
    stacks.add('go');
    suites.push({
      name: 'go',
      stack: 'go',
      command: `gotestsum --junitfile ${R}/go.xml -- ./...`,
      reports: [`${R}/go.xml`],
      format: 'junit',
    });
    notes.push('Go: reports come from gotestsum. Install it with: go install gotest.tools/gotestsum@latest');
    source.add('**/*.go');
    tests.add('**/*_test.go');
  }

  if (!suites.length) notes.push("Couldn't detect a test runner. Add a suite to .nomorebugs/config.json by hand (see the README).");
  return { stacks: [...stacks], suites, source: [...source], tests: [...tests], notes };
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function guessUnityEditor(version) {
  if (process.env.UNITY_EDITOR) return process.env.UNITY_EDITOR;
  if (!version) return null;
  const candidates = isWin
    ? [`C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`, `C:\\Program Files\\Unity ${version}\\Editor\\Unity.exe`]
    : process.platform === 'darwin'
      ? [`/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`]
      : [`${process.env.HOME}/Unity/Hub/Editor/${version}/Editor/Unity`];
  return candidates.find((c) => fs.existsSync(c)) || null;
}
