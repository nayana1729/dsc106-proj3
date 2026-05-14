const MODEL = "MPI-ESM1-2-LR";
  const MARGIN = { top: 16, right: 36, bottom: 44, left: 56 };

  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];

  const VAR_META = {
    tas:     { label: "Global avg. temperature on your birthday",    unit: "°C"     },
    pr:      { label: "Global avg. precipitation on your birthday",  unit: "mm/day" },
    sfcWind: { label: "Global avg. wind speed on your birthday",     unit: "m/s"    },
    huss:    { label: "Global avg. humidity on your birthday",       unit: "kg/kg"  },
    psl:     { label: "Global avg. sea level pressure on your birthday", unit: "Pa" },
    rsds:    { label: "Global avg. solar radiation on your birthday", unit: "W/m²"  },
  };

  let data = [];
  let birthMonth = null, birthDay = null, birthYear = null;
  let activeVar = "tas";

  const selMonth = document.getElementById("sel-month");
  const selDay = document.getElementById("sel-day");
  const selYear = document.getElementById("sel-year");

  selMonth.innerHTML = '<option value="">Month</option>' +
  MONTHS.map((m, i) => `<option value="${i+1}">${m}</option>`).join("");
selDay.innerHTML = '<option value="">Day</option>';
selYear.innerHTML = '<option value="">Year</option>' +
  Array.from({length: 75}, (_, i) => 2024 - i).map(y => `<option value="${y}">${y}</option>`).join("");

function updateDays() {
  const m = +selMonth.value;
  const y = +selYear.value || 2001;
  if (!m) return;
  const daysInMonth = new Date(y, m, 0).getDate();
  const current = +selDay.value;
  selDay.innerHTML = '<option value="">Day</option>' +
    Array.from({length: daysInMonth}, (_, i) => i + 1)
      .map(d => `<option value="${d}"${d === current ? " selected" : ""}>${d}</option>`).join("");
}

async function onDateChange() {
  updateDays();
  const m = +selMonth.value, d = +selDay.value, y = +selYear.value;
  if (!m || !d || !y) return;
  birthMonth = m; birthYear = y;
  if (m === 2 && d === 29) {
    birthDay = 28;
    document.getElementById("chart-subtitle").textContent = "Feb 29 isn't in most years' data — showing Feb 28 instead";
  } else {
    birthDay = d;
  }
  await loadData();
  drawChart();
}

  selMonth.addEventListener("change", onDateChange);
  selDay.addEventListener("change", onDateChange);
  selYear.addEventListener("change", onDateChange);

  document.querySelectorAll(".var-btns button").forEach(btn => {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".var-btns button").forEach(b => b.classList.remove("active"));
      this.classList.add("active");
      activeVar = this.dataset.var;
      drawChart();
    });
  });

async function loadData() {
  const mm = String(birthMonth).padStart(2, "0");
  const dd = String(birthDay).padStart(2, "0");
  try {
    const raw = await d3.csv(`data/climate_${mm}_${dd}.csv`, d => ({
      year: +d.year, variable: d.variable,
      value: +d.value, scenario: d.scenario, model: d.model,
    }));
    data = raw.filter(d => d.model === MODEL);
  } catch(e) {
    console.error("failed to load data for", mm, dd, e);
    data = [];
  }
}

  function drawChart() {
    if (!birthYear) return;

    const container = document.getElementById("chart-container");
    const totalW = container.clientWidth - 40;
    const width = totalW - MARGIN.left - MARGIN.right;
    const height = Math.min(400, Math.max(260, totalW * 0.44)) - MARGIN.top - MARGIN.bottom;

    const meta = VAR_META[activeVar];
    document.getElementById("chart-title").textContent = meta.label;
    if (birthDay !== 28 || birthMonth !== 2) {
      document.getElementById("chart-subtitle").textContent =
        `${MONTHS[birthMonth-1]} ${birthDay} · global mean · CMIP6 MPI-ESM1-2-LR`;
    }

    const varData = data.filter(d => d.variable === activeVar);
    if (!varData.length) return;

    const svg = d3.select("#chart");
    svg.attr("width", width + MARGIN.left + MARGIN.right)
       .attr("height", height + MARGIN.top + MARGIN.bottom);

    svg.selectAll("g.main").remove();
    const g = svg.append("g").attr("class", "main").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    const xScale = d3.scaleLinear()
      .domain([d3.min(varData, d => d.year), d3.max(varData, d => d.year)])
      .range([0, width]);

    const yVals = varData.map(d => d.value);
    const yPad = (d3.max(yVals) - d3.min(yVals)) * 0.1;
    const yScale = d3.scaleLinear()
      .domain([d3.min(yVals) - yPad, d3.max(yVals) + yPad])
      .range([height, 0]).nice();

    g.append("g").attr("class", "grid").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(8).tickSize(-height).tickFormat(""));
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(""));

    g.append("g").attr("transform", `translate(0,${height})`)
      .attr("class", "axis").call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.format("d")));
    g.append("g").attr("class", "axis").call(d3.axisLeft(yScale).ticks(5));

    g.append("text").attr("class", "y-label")
      .attr("transform", "rotate(-90)").attr("x", -height/2).attr("y", -MARGIN.left + 14)
      .attr("text-anchor", "middle").attr("fill", "#3a6a8a").style("font-size", "11px")
      .text(meta.unit);

    const line = d3.line().x(d => xScale(d.year)).y(d => yScale(d.value))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const hist = varData.filter(d => d.scenario === "historical").sort((a,b) => a.year - b.year);
    const bridge = hist.at(-1);
    const s245 = [bridge, ...varData.filter(d => d.scenario === "ssp245").sort((a,b) => a.year - b.year)].filter(Boolean);
    const s585 = [bridge, ...varData.filter(d => d.scenario === "ssp585").sort((a,b) => a.year - b.year)].filter(Boolean);

    const tr = d3.transition().duration(450).ease(d3.easeCubicInOut);

    function animateLine(dataset, cls) {
      let path = g.select(`.${cls}`);
      if (path.empty()) path = g.append("path").attr("class", cls);
      path.datum(dataset).transition(tr).attr("d", line);
    }

    animateLine(hist, "line-hist");
    if (s245.length > 1) animateLine(s245, "line-245");
    if (s585.length > 1) animateLine(s585, "line-585");

    const birthRow = hist.find(d => d.year === birthYear) || hist.find(d => d.year === birthYear + 1);
    const latestRow = hist.at(-1);
    const callout = document.getElementById("stat-callout");
    if (birthRow && latestRow && birthRow.year < latestRow.year) {
      const diff = latestRow.value - birthRow.value;
      const sign = diff >= 0 ? "+" : "";
      callout.textContent = `Since you were born, this has changed ${sign}${diff.toFixed(4)} ${meta.unit} (${birthRow.year} → ${latestRow.year})`;
    } else {
      callout.textContent = "";
    }

    const [xMin, xMax] = xScale.domain();
    if (birthYear >= xMin && birthYear <= xMax) {
      g.append("line").attr("class", "birth-marker")
        .attr("x1", xScale(birthYear)).attr("x2", xScale(birthYear))
        .attr("y1", 0).attr("y2", height);
    }

    const byYear = {};
    varData.forEach(d => { byYear[`${d.year}_${d.scenario}`] = d.value; });

    [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70].forEach(offset => {
      const yr = birthYear + offset;
      if (yr < xMin || yr > xMax) return;
      const scenario = yr <= 2014 ? "historical" : "ssp245";
      const val = byYear[`${yr}_${scenario}`];
      if (val === undefined) return;

      const cx = xScale(yr), cy = yScale(val);
      const isBirth = offset === 0;
      const color = isBirth ? "#0d2d45" : (offset < 0 ? "#7aaac8" : "#1a5a8a");

      g.append("circle").attr("cx", cx).attr("cy", cy)
        .attr("r", isBirth ? 5 : 3.5)
        .attr("fill", color).attr("stroke", "#ddeef8").attr("stroke-width", 1.5);

      const label = isBirth ? "you were born" : (offset > 0 ? `+${offset} yrs` : `${offset} yrs`);
      const anchor = cx > width * 0.82 ? "end" : "start";
      g.append("text").attr("class", "mlabel")
        .attr("x", cx + (anchor === "end" ? -7 : 7)).attr("y", cy + 17)
        .attr("text-anchor", anchor).attr("fill", color)
        .style("font-size", "10px").style("font-family", "monospace")
        .text(label);
    });
  }

  window.addEventListener("resize", () => { if (birthYear) drawChart(); });
