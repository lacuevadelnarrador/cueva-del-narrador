// CATEGORÍAS DE EVENTOS Y CHARLAS (nombres y colores)
// Este archivo lo usan el inicio, el calendario y el curso. Si cambias un color aquí, cambia en todas las pantallas.
// c = color de fondo, t = color del texto sobre ese fondo

const TIPOS = {
  clase:     { n: 'Clase',                        c: '#3E6F77', t: '#FFFFFF' },
  marketing: { n: 'Clase de marketing',           c: '#8797DB', t: '#14262A' },
  sesion:    { n: 'Sesión de escritura conjunta', c: '#E8A9A9', t: '#14262A' },
  invitado:  { n: 'Charla con invitados',         c: '#FFBA55', t: '#14262A' },
  otros:     { n: 'Otros',                        c: '#8FBF9F', t: '#14262A' },
  reto:      { n: 'Reto',                         c: '#A9DDE2', t: '#14262A' }
};
const OTRO = { n: 'Otro', c: '#9DB4B8', t: '#14262A' };

// PUBLICACIONES EN REDES (solo las ve el panel de administración; no son un tipo de evento)
// Van aparte de TIPOS para que no salgan en las leyendas ni en los filtros de eventos.
const PUBLICACION = { n: 'Publicación', c: '#C3A6E0', t: '#14262A' };
// Estados de una publicación, en orden de atención (el primero es el que más la requiere).
// n = etiqueta, p = nombre del filtro, f = nombre en plural femenino para el calendario ("1 pendiente", "2 publicadas"),
// c / t = colores de la etiqueta (el texto va siempre),
// b / s / w = color, trazo y grosor del contorno del día en el calendario del panel (el trazo distinto evita depender solo del color;
// todos tienen al menos 3:1 frente al violeta de PUBLICACION).
const ESTADOS = {
  pendiente:  { n: 'Pendiente',  p: 'Pendientes',  f: ['pendiente', 'pendientes'],   c: '#ECE7DF', t: '#14262A', b: '#B71C1C', s: 'solid',  w: '3px' },
  programado: { n: 'Programado', p: 'Programadas', f: ['programada', 'programadas'], c: '#A9DDE2', t: '#14262A', b: '#0D47A1', s: 'dashed', w: '3px' },
  publicado:  { n: 'Publicado',  p: 'Publicadas',  f: ['publicada', 'publicadas'],   c: '#8FBF9F', t: '#14262A', b: '#1B5E20', s: 'double', w: '4px' }
};
const tipo = k => TIPOS[k] || OTRO;

// QUÉ HACEMOS EN EL CLUB (lo usan la portada y "Sobre el club")
// Cada línea: [tipo, título, descripción]
const ACTIVIDADES = [
  ["clase","Clases","Sesiones sobre técnica y oficio, donde entre todos vemos cómo se construye una historia: personajes, worldbuilding, la raya de diálogo, los adverbios, las figuras literarias, cómo escribir una sinopsis o una propuesta literaria, y mucho más."],
  ["marketing","Clases de marketing","Todo lo que un escritor necesita para darse a conocer: crear un perfil de Instagram, entender el algoritmo, construir comunidad, abrir tu perfil de autor en Amazon y desarrollar tu marca personal."],
  ["sesion","Sesiones de escritura conjunta","Nos juntamos a escribir, cada uno con su proyecto personal o con el común, y compartimos dudas y preguntas según van surgiendo. También hay ratos para leer."],
  ["invitado","Charlas con invitados","Viene alguien del mundo del libro (un autor o autora conocidos, una editorial, un librero, una correctora) y nos cuenta su experiencia para ayudarnos."],
  ["reto","Retos","Cada mes publicamos en Instagram un reto de escritura, normalmente ligado a lo que hemos visto en las clases y en las clases de marketing, para ponerlo en práctica."]
];

// COLORES DE LAS PORTADAS QUE AÚN NO TIENEN IMAGEN (bloque de color con la inicial o el título)
const PALETA = [['#528A93', '#FFFFFF'], ['#8797DB', '#14262A'], ['#E8A9A9', '#14262A'], ['#FFBA55', '#14262A'], ['#A9DDE2', '#14262A']];
const colorPortada = titulo => PALETA[[...titulo].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETA.length];
