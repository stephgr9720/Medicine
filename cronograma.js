/* ============================================================
   PROTOCOLO · Generador de cronograma + export Google Calendar
   Fiorella · camino a cardiología
   ============================================================ */

const PROTO = (() => {

  /* ---- 1. CONFIGURACIÓN EDITABLE ------------------------- */

  // Peso de cada especialidad según su presencia en el examen.
  // Editá estos números si querés otra distribución. Suman 100.
  const PESOS = {
    "Medicina Interna":      28,
    "Cirugía":               18,
    "Pediatría":             15,
    "Gineco-Obstetricia":    15,
    "Salud Pública":         12,
    "Psiquiatría":            6,
    "Cardiología (refuerzo)": 6
  };

  // Temario. Agregá o quitá subtemas libremente.
  const TEMARIO = {
    "Medicina Interna": [
      "Insuficiencia cardíaca", "Síndrome coronario agudo", "Arritmias",
      "Hipertensión arterial", "EPOC y asma", "Neumonía adquirida en comunidad",
      "Diabetes mellitus", "Tiroides", "ERC y síndrome nefrótico",
      "Hepatopatías", "Anemia", "Sepsis y shock"
    ],
    "Cirugía": [
      "Abdomen agudo", "Apendicitis", "Colecistitis y coledocolitiasis",
      "Obstrucción intestinal", "Hernias", "Trauma abdominal",
      "Trauma de tórax", "Quemaduras", "Pie diabético"
    ],
    "Pediatría": [
      "Neonatología: ictericia y sepsis", "Crecimiento y desarrollo",
      "Inmunizaciones", "IRA en pediatría", "EDA y deshidratación",
      "Desnutrición y anemia infantil", "Convulsión febril", "Cardiopatías congénitas"
    ],
    "Gineco-Obstetricia": [
      "Control prenatal", "Hemorragia primera mitad", "Hemorragia segunda mitad",
      "Preeclampsia y eclampsia", "Trabajo de parto y distocias",
      "Hemorragia postparto", "Infecciones de transmisión sexual",
      "Planificación familiar", "Cáncer de cuello uterino"
    ],
    "Salud Pública": [
      "Medidas de frecuencia", "Medidas de asociación", "Tipos de estudio",
      "Sensibilidad y especificidad", "Tamizaje", "Vigilancia epidemiológica",
      "Sistema de salud peruano", "Bioestadística básica"
    ],
    "Psiquiatría": [
      "Depresión y riesgo suicida", "Trastornos de ansiedad",
      "Esquizofrenia y psicosis", "Trastorno bipolar",
      "Consumo de sustancias", "Delirium vs demencia"
    ],
    "Cardiología (refuerzo)": [
      "ECG sistemático", "Valvulopatías", "Miocardiopatías",
      "Endocarditis", "Pericarditis y taponamiento", "Fibrilación auricular",
      "Dislipidemia y riesgo CV", "Emergencias hipertensivas"
    ]
  };

  // Horarios de los bloques (formato 24h). 4+1 bloques al día.
  const BLOQUES = [
    { inicio: "06:00", fin: "07:30", tipo: "nuevo"   },
    { inicio: "08:00", fin: "09:30", tipo: "nuevo"   },
    { inicio: "15:00", fin: "16:30", tipo: "nuevo"   },
    { inicio: "17:00", fin: "18:30", tipo: "nuevo"   },
    { inicio: "21:00", fin: "21:45", tipo: "repaso"  }
  ];

  const DIAS_ESTUDIO = [1,2,3,4,5,6];  // lunes=1 ... sábado=6. Domingo = simulacro.
  const SIMULACRO = { dia: 0, inicio: "09:00", fin: "12:00" };
  const TZ = "America/Lima";

  /* ---- 2. REPASO ESPACIADO ------------------------------- */
  // Un tema visto el día D reaparece como repaso nocturno.
  const INTERVALOS = [1, 3, 7, 21];


  /* ---- 3. GENERADOR -------------------------------------- */

  function repartirBloques(totalBloques) {
    // Reparte bloques proporcionalmente al peso, con redondeo justo
    const entradas = Object.entries(PESOS);
    const crudos = entradas.map(([esp, p]) => ({
      esp, exacto: totalBloques * p / 100
    }));
    let asignados = crudos.map(c => ({ esp: c.esp, n: Math.floor(c.exacto), resto: c.exacto % 1 }));
    let faltan = totalBloques - asignados.reduce((s, a) => s + a.n, 0);
    asignados.sort((a, b) => b.resto - a.resto);
    for (let i = 0; i < faltan; i++) asignados[i % asignados.length].n++;
    const out = {};
    asignados.forEach(a => out[a.esp] = a.n);
    return out;
  }

  function generar(fechaInicio, fechaExamen) {
    const ini = new Date(fechaInicio + "T00:00:00");
    const fin = new Date(fechaExamen + "T00:00:00");
    if (isNaN(ini) || isNaN(fin) || fin <= ini) {
      throw new Error("Revisá las fechas: el examen debe ser posterior al inicio.");
    }

    // Contar días de estudio disponibles
    const diasEstudio = [];
    const domingos = [];
    for (let d = new Date(ini); d < fin; d.setDate(d.getDate() + 1)) {
      const copia = new Date(d);
      if (copia.getDay() === SIMULACRO.dia) domingos.push(copia);
      else if (DIAS_ESTUDIO.includes(copia.getDay())) diasEstudio.push(copia);
    }

    const bloquesNuevos = BLOQUES.filter(b => b.tipo === "nuevo").length;
    const capacidad = diasEstudio.length * bloquesNuevos;

    // Cuántos bloques por especialidad
    const cupos = repartirBloques(capacidad);

    // Construir cola de temas: cada especialidad aporta sus temas ciclando
    // hasta llenar su cupo, y luego se intercalan para que no queden en bloque.
    const colas = {};
    Object.entries(cupos).forEach(([esp, n]) => {
      const temas = TEMARIO[esp] || [esp];
      colas[esp] = Array.from({ length: n }, (_, i) => ({
        esp, tema: temas[i % temas.length],
        vuelta: Math.floor(i / temas.length) + 1
      }));
    });

    // Intercalado round-robin ponderado
    const cola = [];
    const pendientes = Object.keys(colas).filter(e => colas[e].length);
    const restantes = {};
    pendientes.forEach(e => restantes[e] = colas[e].length);
    while (cola.length < capacidad) {
      const activos = Object.keys(restantes).filter(e => restantes[e] > 0);
      if (!activos.length) break;
      // el que tiene más pendientes proporcionalmente va primero
      activos.sort((a, b) => restantes[b] - restantes[a]);
      const esp = activos[0];
      cola.push(colas[esp][colas[esp].length - restantes[esp]]);
      restantes[esp]--;
    }

    // Asignar a días y bloques
    const eventos = [];
    let idx = 0;
    const historial = [];   // para repasos espaciados

    diasEstudio.forEach(dia => {
      const delDia = [];
      BLOQUES.forEach(bloque => {
        if (bloque.tipo === "nuevo") {
          const item = cola[idx++];
          if (!item) return;
          delDia.push(item);
          historial.push({ fecha: new Date(dia), ...item });
          eventos.push({
            titulo: `${item.esp} · ${item.tema}`,
            desc: faseDesc(item),
            fecha: new Date(dia),
            inicio: bloque.inicio,
            fin: bloque.fin,
            cat: "nuevo"
          });
        } else {
          // bloque de repaso: temas que tocan hoy según intervalos
          const hoy = dia.getTime();
          const aRepasar = historial.filter(h =>
            INTERVALOS.some(iv => {
              const t = new Date(h.fecha);
              t.setDate(t.getDate() + iv);
              return t.toDateString() === new Date(hoy).toDateString();
            })
          );
          const lista = aRepasar.length
            ? aRepasar.map(h => `${h.esp}: ${h.tema}`).join(" · ")
            : "Flashcards pendientes + Banco de Preguntas";
          eventos.push({
            titulo: "Repaso nocturno · cierre de errores",
            desc: `Repaso espaciado (1/3/7/21 días):\n${lista}\n\nCerrá los errores del día en el Banco de Preguntas.`,
            fecha: new Date(dia),
            inicio: bloque.inicio,
            fin: bloque.fin,
            cat: "repaso"
          });
        }
      });
    });

    // Simulacros dominicales
    domingos.forEach((d, i) => {
      eventos.push({
        titulo: `Simulacro semanal #${i + 1}`,
        desc: "Simulacro cronometrado. Al terminar, todos los errores van al Banco de Preguntas y se convierten en flashcards esa misma tarde.",
        fecha: new Date(d),
        inicio: SIMULACRO.inicio,
        fin: SIMULACRO.fin,
        cat: "simulacro"
      });
    });

    return { eventos, cupos, capacidad, diasEstudio: diasEstudio.length, simulacros: domingos.length };
  }

  function faseDesc(item) {
    return [
      `Bloque de 90 minutos · ${item.esp}`,
      ``,
      `FASE 01 — Comprender (25 min)`,
      `Leé el tema una vez sin marcar. Cerrá la fuente y armá el mindmap de memoria. Completá en otro color lo que faltó.`,
      ``,
      `FASE 02 — Aplicar (35 min)`,
      `IA socrática: pedile que te interrogue clínicamente sobre ${item.tema}, una pregunta a la vez, sin darte la respuesta hasta que intentes. Cada error va al Banco de Preguntas.`,
      ``,
      `FASE 03 — Consolidar (20 min)`,
      `Solo lo que fallaste → flashcards. Una tarjeta = un concepto, formulada como "por qué" o "cómo", nunca "qué".`
    ].join("\n");
  }


  /* ---- 4. EXPORT .ICS ------------------------------------ */

  function pad(n) { return String(n).padStart(2, "0"); }

  function stampLocal(fecha, hhmm) {
    const [h, m] = hhmm.split(":");
    return `${fecha.getFullYear()}${pad(fecha.getMonth() + 1)}${pad(fecha.getDate())}T${h}${m}00`;
  }

  function escapeICS(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function fold(line) {
    // RFC 5545: líneas de máx 75 octetos
    const out = [];
    let s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
    out.push(s);
    return out.join("\r\n");
  }

  function toICS(eventos) {
    const now = new Date();
    const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Protocolo Residentado//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Protocolo · Residentado",
      `X-WR-TIMEZONE:${TZ}`,
      "BEGIN:VTIMEZONE",
      `TZID:${TZ}`,
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0500",
      "TZNAME:-05",
      "END:STANDARD",
      "END:VTIMEZONE"
    ];

    eventos.forEach((e, i) => {
      const uid = `proto-${stampLocal(e.fecha, e.inicio)}-${i}@protocolo.local`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=${TZ}:${stampLocal(e.fecha, e.inicio)}`,
        `DTEND;TZID=${TZ}:${stampLocal(e.fecha, e.fin)}`,
        fold(`SUMMARY:${escapeICS(e.titulo)}`),
        fold(`DESCRIPTION:${escapeICS(e.desc)}`),
        `CATEGORIES:${e.cat.toUpperCase()}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT10M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Bloque de estudio en 10 minutos",
        "END:VALARM",
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function descargarICS(eventos, nombre = "protocolo-residentado.ics") {
    const blob = new Blob([toICS(eventos)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { PESOS, TEMARIO, BLOQUES, generar, toICS, descargarICS };

})();
