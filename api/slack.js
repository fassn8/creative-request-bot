import crypto from 'crypto';
import { parse } from 'querystring';

const SLACK_BOT_TOKEN     = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const MONDAY_API_TOKEN    = process.env.MONDAY_API_TOKEN;
const MONDAY_BOARD_ID     = process.env.MONDAY_BOARD_ID;

const COLUMN_IDS = {
  requestType:  'color_mkrz36fr',
  description:  'creative_brief',
  dueDate:      'date_mkrzgh6v',
  requester:    'short_textwbcjl16e',
  links:        'long_text_mkrz10xz',
};

function verifySlackSignature(headers, rawBody) {
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig  = headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const computed = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBase).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig));
  } catch { return false; }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function openModal(triggerId) {
  const modal = {
    type: 'modal',
    callback_id: 'creative_request_modal',
    title:  { type: 'plain_text', text: 'Creative Request' },
    submit: { type: 'plain_text', text: 'Submit Request' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'project_name',
        label: { type: 'plain_text', text: 'Project / Request Name', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'e.g. Q3 Campaign Hero Banner' },
        },
      },
      {
        type: 'input',
        block_id: 'request_type',
        label: { type: 'plain_text', text: 'Request Type', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a type' },
          options: [
            { text: { type: 'plain_text', text: 'Event'           }, value: 'Event'           },
            { text: { type: 'plain_text', text: 'Paid Acquisition' }, value: 'Paid Acquisition' },
            { text: { type: 'plain_text', text: 'Social Media'     }, value: 'Social Media'     },
            { text: { type: 'plain_text', text: 'Blog'             }, value: 'Blog'             },
            { text: { type: 'plain_text', text: 'Website'          }, value: 'Website'          },
            { text: { type: 'plain_text', text: 'Case Study'       }, value: 'Case Study'       },
            { text: { type: 'plain_text', text: 'DG Campaign'      }, value: 'DG Campaign'      },
            { text: { type: 'plain_text', text: 'Slide Deck'       }, value: 'Slide Deck'       },
            { text: { type: 'plain_text', text: 'Document'         }, value: 'Document'         },
            { text: { type: 'plain_text', text: 'Video'            }, value: 'Video'            },
            { text: { type: 'plain_text', text: 'UI Design'        }, value: 'UI Design'        },
            { text: { type: 'plain_text', text: 'One Pager'        }, value: 'One Pager'        },
            { text: { type: 'plain_text', text: 'E-Book'           }, value: 'E-Book'           },
            { text: { type: 'plain_text', text: 'Other'            }, value: 'Other'            },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'description',
        label: { type: 'plain_text', text: 'Description / Brief', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Describe what you need, the goal, target audience, key messages, dimensions, etc.',
          },
        },
      },
      {
        type: 'input',
        block_id: 'due_date',
        label: { type: 'plain_text', text: 'Due Date', emoji: true },
        element: {
          type: 'datepicker',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Pick a date' },
        },
      },
      {
        type: 'input',
        block_id: 'requester',
        label: { type: 'plain_text', text: 'Your Canopy email address', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'e.g. jason@canopyworks.com' },
        },
      },
      {
        type: 'input',
        block_id: 'links',
        optional: true,
        label: { type: 'plain_text', text: 'Links or References', emoji: true },
        hint: {
          type: 'plain_text',
          text: 'Brand guidelines, inspiration, existing assets - anything helpful.',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'https://...' },
        },
      },
    ],
  };

  const response = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });

  const result = await response.json();
  if (!result.ok) console.error('Failed to open modal:', result.error);
  return result;
}

async function createMondayItem({ projectName, requestType, description, dueDate, requester, links }) {
  const columnValues = {
    [COLUMN_IDS.requestType]: { label: requestType },
    [COLUMN_IDS.description]: { text: description },
    [COLUMN_IDS.dueDate]:     { date: dueDate },
    [COLUMN_IDS.requester]:   requester,
    [COLUMN_IDS.links]:       links || '',
  };

  const safeName     = projectName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const columnValStr = JSON.stringify(JSON.stringify(columnValues));

  const query = `
    mutation {
      create_item(
        board_id: ${MONDAY_BOARD_ID},
        item_name: "${safeName}",
        column_values: ${columnValStr}
      ) { id name }
    }
  `;

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: MONDAY_API_TOKEN },
    body: JSON.stringify({ query }),
  });

  const result = await response.json();
  if (result.errors) { console.error('Monday.com API error:', JSON.stringify(result.errors)); return null; }
  return result?.data?.create_item ?? null;
}

async function sendConfirmationDM(userId, projectName, mondayItemId) {
  const itemUrl = `https://monday.com/boards/${MONDAY_BOARD_ID}/pulses/${mondayItemId}`;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({
      channel: userId,
      text: `Your creative request has been submitted!`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `✅ *Your creative request has been submitted!*\n\n*"${projectName}"* is now live on the Creative board in Monday.com.` },
        },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'View in Monday.com' }, url: itemUrl, style: 'primary' }],
        },
      ],
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const rawBody = await readRawBody(req);

  if (!verifySlackSignature(req.headers, rawBody)) {
    console.warn('Slack signature verification failed');
    return res.status(401).send('Unauthorized');
  }

  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) return res.status(400).send('Bad Request');

  const body = parse(rawBody);

  if (body.payload) {
    const payload = JSON.parse(body.payload);

    if (payload.type === 'view_submission' && payload.view.callback_id === 'creative_request_modal') {
      const v = payload.view.state.values;

      const formData = {
        projectName: v.project_name.value.value,
        requestType: v.request_type.value.selected_option.value,
        description: v.description.value.value,
        dueDate:     v.due_date.value.selected_date,
        requester:   v.requester.value.value,
        links:       v.links?.value?.value ?? '',
      };

      const mondayItem = await createMondayItem(formData);
      res.status(200).json({ response_action: 'clear' });

      if (mondayItem?.id) {
        await sendConfirmationDM(payload.user.id, formData.projectName, mondayItem.id);
      } else {
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          body: JSON.stringify({
            channel: payload.user.id,
            text: `Your request "${formData.projectName}" was received but there was an issue creating it in Monday.com. Please contact your admin.`,
          }),
        });
      }
      return;
    }
    return res.status(200).send('');
  }

  if (body.command === '/flare') {
    const { trigger_id } = body;
    if (!trigger_id) return res.status(400).send('Missing trigger_id');
    res.status(200).send('');
    await openModal(trigger_id);
    return;
  }

  return res.status(200).send('');
}
