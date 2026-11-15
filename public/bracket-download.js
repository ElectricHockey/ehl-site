function bracketExportImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A bracket logo could not be loaded for export.'));
    image.src = url;
  });
}

function bracketExportBox(element, origin) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
}

function bracketExportSnapshot(grid, league, season) {
  const origin = grid.getBoundingClientRect();
  const box = element => bracketExportBox(element, origin);
  const colors = element => ({
    color1: element.style.getPropertyValue('--team-color-1').trim(),
    color2: element.style.getPropertyValue('--team-color-2').trim(),
  });
  const titles = [...grid.querySelectorAll('.b-round-title')].map(element => ({
    ...box(element), text: element.textContent.trim(),
  }));
  const cards = [...grid.querySelectorAll('.b-series')].map(element => ({
    ...box(element),
    rows: [...element.querySelectorAll('.b-team')].map(row => ({
      ...box(row), ...colors(row),
      seed: row.querySelector('.b-seed')?.textContent.trim() || '',
      name: row.querySelector('.b-team-name, .b-tbd')?.textContent.trim() || '',
      wins: row.querySelector('.b-wins')?.textContent.trim() || '',
      logo: row.querySelector('.b-logo')?.src || '',
      winner: row.classList.contains('b-winner'),
      loser: row.classList.contains('b-loser'),
      empty: row.classList.contains('b-team-empty'),
    })),
  }));
  const champElement = grid.querySelector('.b-champ-box');
  const champion = { ...box(champElement), ...colors(champElement),
    name: champElement.querySelector('.b-champ-name').textContent.trim() };
  return {
    width: Math.ceil(origin.width),
    height: Math.ceil(Math.max(origin.height, champion.y + champion.height + 190)),
    league, season, titles, cards, champion,
    paths: [...grid.querySelectorAll('.bracket-svg path')].map(path => path.getAttribute('d')),
  };
}

function bracketExportRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function bracketExportFillTeam(ctx, box) {
  if (box.color1) {
    const gradient = ctx.createLinearGradient(box.x, box.y, box.x + box.width, box.y + box.height);
    gradient.addColorStop(0, box.color1);
    gradient.addColorStop(1, box.color2 || box.color1);
    ctx.fillStyle = gradient;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.fillStyle = 'rgba(4,10,20,.62)';
  } else {
    ctx.fillStyle = '#121b29';
  }
  ctx.fillRect(box.x, box.y, box.width, box.height);
}

function bracketExportDrawImage(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

async function bracketExportPng(snapshot) {
  const urls = [...new Set(snapshot.cards.flatMap(card => card.rows.map(row => row.logo)).filter(Boolean))];
  urls.push('/api/site-logo');
  const loaded = await Promise.all(urls.map(bracketExportImage));
  const images = new Map(urls.map((url, i) => [url, loaded[i]]));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const headerHeight = 78;
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width * 2;
  canvas.height = (snapshot.height + headerHeight) * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is not supported by this browser.');
  ctx.scale(2, 2);
  ctx.fillStyle = '#080e19';
  ctx.fillRect(0, 0, snapshot.width, snapshot.height + headerHeight);
  const glow = ctx.createLinearGradient(0, 0, snapshot.width, snapshot.height + headerHeight);
  glow.addColorStop(0, 'rgba(0,172,245,.13)');
  glow.addColorStop(.55, 'rgba(0,0,0,0)');
  glow.addColorStop(1, 'rgba(197,0,238,.15)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, snapshot.width, snapshot.height + headerHeight);

  const right = snapshot.width - 28;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#dceefa';
  ctx.font = '800 20px Inter, Arial, sans-serif';
  ctx.fillText(`${snapshot.league} PLAYOFFS`, right, 28, snapshot.width - 56);
  ctx.fillStyle = '#a7bdd3';
  ctx.font = '700 14px Inter, Arial, sans-serif';
  ctx.fillText(snapshot.season, right, 54, snapshot.width - 56);
  ctx.translate(0, headerHeight);

  ctx.strokeStyle = 'rgba(140,171,197,.7)';
  ctx.lineWidth = 1.5;
  snapshot.paths.forEach(path => ctx.stroke(new Path2D(path)));
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  snapshot.titles.forEach(title => {
    ctx.fillStyle = '#a7bdd3';
    ctx.font = '800 11px Inter, Arial, sans-serif';
    ctx.fillText(title.text.toUpperCase(), title.x, title.y + title.height / 2);
  });
  snapshot.cards.forEach(card => {
    ctx.save();
    bracketExportRoundedRect(ctx, card.x, card.y, card.width, card.height, 7);
    ctx.clip();
    card.rows.forEach(row => {
      ctx.save();
      if (row.loser) ctx.globalAlpha = .65;
      bracketExportFillTeam(ctx, row);
      if (row.winner) {
        ctx.fillStyle = '#72e3ff';
        ctx.fillRect(row.x, row.y, 3, row.height);
      }
      ctx.textBaseline = 'middle';
      ctx.font = '800 11px Inter, Arial, sans-serif';
      ctx.fillStyle = '#d7e3ef';
      ctx.textAlign = 'center';
      ctx.fillText(row.seed, row.x + 20, row.y + row.height / 2);
      ctx.textAlign = 'left';
      if (row.logo) bracketExportDrawImage(ctx, images.get(row.logo), row.x + 39, row.y + (row.height - 25) / 2, 25, 25);
      ctx.font = `800 ${row.empty ? 12 : 14}px Inter, Arial, sans-serif`;
      ctx.fillStyle = row.empty ? '#96a5b7' : '#ffffff';
      ctx.fillText(row.name, row.x + (row.empty ? 39 : 73), row.y + row.height / 2, row.empty ? row.width - 45 : row.width - 108);
      if (row.wins) {
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.beginPath();
        ctx.moveTo(row.x + row.width - 39, row.y + 8);
        ctx.lineTo(row.x + row.width - 39, row.y + row.height - 8);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(row.wins, row.x + row.width - 24, row.y + row.height / 2);
      }
      ctx.restore();
    });
    ctx.restore();
    ctx.strokeStyle = '#64768b';
    ctx.lineWidth = 1;
    bracketExportRoundedRect(ctx, card.x + .5, card.y + .5, card.width - 1, card.height - 1, 7);
    ctx.stroke();
  });
  const champion = snapshot.champion;
  ctx.save();
  bracketExportRoundedRect(ctx, champion.x, champion.y, champion.width, champion.height, 7);
  ctx.clip();
  bracketExportFillTeam(ctx, champion);
  ctx.restore();
  ctx.strokeStyle = '#a87ee0';
  bracketExportRoundedRect(ctx, champion.x + .5, champion.y + .5, champion.width - 1, champion.height - 1, 7);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d8c6f4';
  ctx.font = '800 11px Inter, Arial, sans-serif';
  ctx.fillText('CHAMPION', champion.x + 16, champion.y + 30);
  ctx.fillStyle = '#fff';
  ctx.font = '800 14px Inter, Arial, sans-serif';
  ctx.fillText(champion.name, champion.x + 16, champion.y + 53, champion.width - 32);

  const bottom = snapshot.height - 24;
  bracketExportDrawImage(ctx, images.get('/api/site-logo'), right - 125, bottom - 125, 125, 125);
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Could not create the bracket image.')), 'image/png'));
}

async function downloadBracket() {
  const button = document.getElementById('bracket-download');
  const status = document.getElementById('bracket-download-status');
  const grid = document.getElementById('bracket-grid');
  if (!button || !status || !grid) return;
  button.disabled = true;
  status.textContent = 'Preparing image…';
  try {
    drawBracketLines();
    const selected = document.getElementById('season-select');
    const season = selected?.selectedOptions[0]?.textContent.replace(/\s*★\s*$/, '').replace(/\s+playoffs\s*$/i, '').trim() || 'Season';
    const league = SeasonSelector.getSelectedLeagueType() === 'sixes' ? "6's" : "3's";
    const snapshot = bracketExportSnapshot(grid, league, season);
    const blob = await bracketExportPng(snapshot);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EHL-${league.replace("'", '')}-${season.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}-bracket.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '';
  } catch (error) {
    console.error('[playoffs] bracket export failed:', error);
    status.textContent = 'Could not download the bracket. Check that the logos are accessible and try again.';
  } finally {
    button.disabled = false;
  }
}
