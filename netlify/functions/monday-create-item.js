// netlify/functions/monday-create-item.js
//
// Server-side proxy to Monday.com's API. This exists so the Monday API
// token never has to be sent to, or stored in, the browser.
//
// Required setup (one-time):
//   1. In Monday.com: avatar (top-right) → Administration → API
//      (or Profile → Developers → "My Access Tokens") → copy your
//      personal API v2 token.
//   2. In Netlify: Site settings → Environment variables → add a
//      variable named MONDAY_API_TOKEN with that token as the value.
//   3. Redeploy the site so the function picks up the new env var.
//
// The board ID is NOT a secret — it's fine to keep that in the app
// itself (Settings page) and send it from the browser on each request.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'MONDAY_API_TOKEN is not set on the server. Add it under Netlify Site settings → Environment variables, then redeploy.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { boardId, itemName, updateText } = payload;
  if (!boardId || !itemName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'boardId and itemName are required' }) };
  }

  try {
    // 1. Create the item on the board
    const createItemQuery = `
      mutation ($boardId: ID!, $itemName: String!) {
        create_item (board_id: $boardId, item_name: $itemName) { id }
      }
    `;
    const itemRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': '2024-01',
      },
      body: JSON.stringify({
        query: createItemQuery,
        variables: { boardId: String(boardId), itemName: String(itemName) },
      }),
    });
    const itemData = await itemRes.json();
    if (itemData.errors) {
      return { statusCode: 502, body: JSON.stringify({ error: itemData.errors[0]?.message || 'Monday API rejected the request', details: itemData.errors }) };
    }
    const newItemId = itemData.data && itemData.data.create_item && itemData.data.create_item.id;
    if (!newItemId) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Monday API did not return an item id', details: itemData }) };
    }

    // 2. Post the full request text as an update (comment) on that item
    if (updateText) {
      const createUpdateQuery = `
        mutation ($itemId: ID!, $body: String!) {
          create_update (item_id: $itemId, body: $body) { id }
        }
      `;
      await fetch('https://api.monday.com/v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
          'API-Version': '2024-01',
        },
        body: JSON.stringify({
          query: createUpdateQuery,
          variables: { itemId: newItemId, body: String(updateText) },
        }),
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, itemId: newItemId }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
