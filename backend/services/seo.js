const escapeAttr=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function renderHomeHtml(html,{baseURL,catalog}){
  const title='Dobrões de Fé — detalhes que fazem história';
  const description='Cinco dobrões de santos católicos para celebrar a fé, guardar boas histórias e presentear com significado.';
  const url=baseURL+'/';
  const structured={
    '@context':'https://schema.org',
    '@type':'ItemList',
    name:'Dobrões de Fé',
    itemListElement:(catalog||[]).filter(p=>p?.enabled!==false).map((p,index)=>({
      '@type':'ListItem',position:index+1,item:{'@type':'Product',name:p.name,offers:Number.isSafeInteger(p.priceCents)&&p.priceCents>0?{'@type':'Offer',priceCurrency:'BRL',price:(p.priceCents/100).toFixed(2),availability:'https://schema.org/InStock'}:undefined}
    }))
  };
  const tags=`\n<link rel="canonical" href="${escapeAttr(url)}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="pt_BR">\n<meta property="og:title" content="${escapeAttr(title)}">\n<meta property="og:description" content="${escapeAttr(description)}">\n<meta property="og:url" content="${escapeAttr(url)}">\n<meta name="twitter:card" content="summary">\n<script type="application/ld+json">${JSON.stringify(structured).replace(/</g,'\\u003c')}</script>\n`;
  return html.includes('rel="canonical"')?html:html.replace('</head>',tags+'</head>');
}

export function sitemapXml(baseURL){
  const url=(baseURL+'/').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`;
}

export function robotsTxt(baseURL){return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /sucesso\nDisallow: /api/\nSitemap: ${baseURL}/sitemap.xml\n`;}
