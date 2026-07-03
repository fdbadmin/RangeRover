/**
 * Test: Save/Load project round-trip via JSDOM
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const appJs = fs.readFileSync('app.js', 'utf8');

// Build a standalone HTML for JSDOM (strip the Plotly CDN tag — real Plotly
// cannot run under jsdom and would overwrite the stub / crash on canvas APIs)
const standaloneSrc = html
  .replace('<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>', '')
  .replace(
    '<script src="app.js"></script>',
    `<script>window.Plotly = { newPlot(){ return Promise.resolve(); }, relayout(){ return Promise.resolve(); }, purge(){} };\n${appJs}\n</script>`
  );

const dom = new JSDOM(standaloneSrc, { runScripts: 'dangerously' });
const win = dom.window;
const doc = win.document;

// Wait for DOMContentLoaded
setTimeout(() => {
  try {
    // 1. Set up some values in basic mode
    doc.getElementById('fluid').value = 'gas';
    doc.getElementById('fluid').dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('iterations').value = '5000';
    doc.getElementById('seed').value = '42';

    // Set parameter values
    const rows = [...doc.querySelectorAll('#params .dist-row')];
    for (const row of rows) {
      const inputs = [...row.querySelectorAll('input.v')];
      inputs[0].value = '10';
      inputs[1].value = '50';
      inputs[2].value = '100';
    }

    // RF values
    const rfInputs = [...doc.querySelectorAll('.rf-v')];
    rfInputs[0].value = '0.3';
    rfInputs[1].value = '0.5';
    rfInputs[2].value = '0.7';

    // 2. Serialize
    const project = win.serializeProject();
    console.log('=== Serialized Project ===');
    console.log('version:', project.version);
    console.log('advancedMode:', project.advancedMode);
    console.log('fluid setting:', project.settings.fluid);
    console.log('iterations:', project.settings.iterations);
    console.log('seed:', project.settings.seed);
    console.log('reservoirs:', project.reservoirs.length);
    console.log('reservoir[0].fluid:', project.reservoirs[0].fluid);
    console.log('reservoir[0].dists count:', project.reservoirs[0].dists.length);
    console.log('reservoir[0].rfRaw:', project.reservoirs[0].rfRaw);

    // Verify dist values were captured
    for (const d of project.reservoirs[0].dists) {
      console.log(`  ${d.name}: type=${d.type}, raw=[${d.raw}]`);
    }

    // 3. Reset fluid to oil (simulates a fresh state)
    doc.getElementById('fluid').value = 'oil';
    doc.getElementById('fluid').dispatchEvent(new win.Event('change', { bubbles: true }));
    doc.getElementById('iterations').value = '10000';
    doc.getElementById('seed').value = '';

    // 4. Deserialize (restore the saved project)
    const jsonStr = JSON.stringify(project);
    const restored = JSON.parse(jsonStr);
    win.deserializeProject(restored);

    // 5. Verify restored state
    const fluidAfter = doc.getElementById('fluid').value;
    const iterAfter = doc.getElementById('iterations').value;
    const seedAfter = doc.getElementById('seed').value;

    console.log('\n=== After Restore ===');
    console.log('fluid:', fluidAfter, fluidAfter === 'gas' ? '✓' : '✗ EXPECTED gas');
    console.log('iterations:', iterAfter, iterAfter === '5000' ? '✓' : '✗ EXPECTED 5000');
    console.log('seed:', seedAfter, seedAfter === '42' ? '✓' : '✗ EXPECTED 42');

    // Verify parameters restored
    const rowsAfter = [...doc.querySelectorAll('#params .dist-row')];
    let allOk = true;
    for (const row of rowsAfter) {
      const name = row.getAttribute('data-param');
      const inputs = [...row.querySelectorAll('input.v')];
      const vals = inputs.map(i => i.value);
      console.log(`  ${name}: [${vals}]`);
      if (vals[0] !== '10' || vals[1] !== '50' || vals[2] !== '100') allOk = false;
    }
    console.log('All param values restored:', allOk ? '✓' : '✗ FAIL');

    const rfAfter = [...doc.querySelectorAll('.rf-v')].map(x => x.value);
    console.log('RF restored:', rfAfter, (rfAfter[0] === '0.3' && rfAfter[1] === '0.5' && rfAfter[2] === '0.7') ? '✓' : '✗ FAIL');

    // 6. Test advanced mode round-trip
    console.log('\n=== Advanced Mode Test ===');
    const advToggle = doc.getElementById('advancedModeToggle');
    advToggle.checked = true;
    advToggle.dispatchEvent(new win.Event('change'));

    // Add a second reservoir (the add button is .tab-add inside #reservoirTabs)
    const addBtn = doc.querySelector('#reservoirTabs .tab-add');
    if (addBtn) addBtn.click();

    // Switch to reservoir 2 and change its fluid
    const tabs = doc.querySelectorAll('#reservoirTabs .tab');
    if (tabs.length >= 2) {
      tabs[1].click();
      doc.getElementById('fluid').value = 'oil';
      doc.getElementById('fluid').dispatchEvent(new win.Event('change', { bubbles: true }));
    }

    // Serialize advanced mode
    const advProject = win.serializeProject();
    console.log('Advanced reservoirs count:', advProject.reservoirs.length);
    console.log('advancedMode:', advProject.advancedMode);
    console.log('R1 fluid:', advProject.reservoirs[0].fluid);
    console.log('R2 fluid:', advProject.reservoirs.length > 1 ? advProject.reservoirs[1].fluid : 'N/A');

    // Reset to basic
    advToggle.checked = false;
    advToggle.dispatchEvent(new win.Event('change'));
    doc.getElementById('fluid').value = 'csg';
    doc.getElementById('fluid').dispatchEvent(new win.Event('change', { bubbles: true }));

    // Restore advanced project
    win.deserializeProject(advProject);
    // top-level let/const are not exposed on window under jsdom — read via eval
    const advModeAfter = win.eval('advancedMode');
    const resCountAfter = win.eval('reservoirs').length;
    console.log('\nAfter advanced restore:');
    console.log('advancedMode:', advModeAfter, advModeAfter ? '✓' : '✗');
    console.log('reservoirs:', resCountAfter, resCountAfter >= 2 ? '✓' : '✗');

    if (!allOk || !advModeAfter || resCountAfter < 2) {
      console.error('\n=== TEST FAILED: one or more checks did not pass ===');
      process.exit(1);
    }
    console.log('\n=== ALL TESTS PASSED ===');
  } catch (err) {
    console.error('TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}, 200);
