// ============================================================
// ST-BetterImgGen v1.0.4 — ComfyUI Image Generation Extension for SillyTavern 
// Extension ID: ST-BetterImgGen
// Display Name: Better Image Generation
// ============================================================

import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { ARGUMENT_TYPE, SlashCommandArgument } from '../../../slash-commands/SlashCommandArgument.js';

// ── Constants ─────────────────────────────────────────────

const EXTENSION_ID = 'ST-BetterImgGen';
const EXTENSION_NAME = 'Better Image Generation';
const SETTINGS_KEY = 'ST-BetterImgGen';

// ── Default Settings ──────────────────────────────────────

const DEFAULT_SETTINGS = {
    // ComfyUI Connection
    comfyuiUrl: '',
    workflowJson: '',

    // Generation Settings
    model: '',
    vae: '',
    sampler: '',
    scheduler: '',
    steps: 20,
    cfgScale: 7,
    width: 512,
    height: 512,
    denoisingStrength: 0.7,
    seed: -1,
    clipSkip: 1,

    // Prompt Settings
    stylePrefix: 'masterpiece, best quality, ',
    negativePrompt: '',
    editBeforeGenerate: false,

    // Prompt Templates
    promptTemplates: [
        {
            name: 'Current Scene',
            instruction: 'Describe the current scene in the following chat as a Stable Diffusion prompt. Focus on the setting, mood, and any characters mentioned. Use [[CharacterName]] to refer to each character by their name in brackets.',
        },
        {
            name: 'Custom',
            instruction: 'Generate a Stable Diffusion prompt based on the chat context.',
        },
        {
            name: 'No Context',
            instruction: 'Generate a Stable Diffusion prompt based solely on your knowledge, without using any chat history.',
        },
    ],

    // Generation Modes
    generationModes: [
        {
            name: 'Scene',
            promptTemplateIndex: 0,
            description: 'Generate an image of the current scene',
        },
        {
            name: 'Portrait',
            promptTemplateIndex: 0,
            description: 'Generate a character portrait',
        },
    ],

    // LoRA Rules
    loraRules: [],

    // Character Tags
    characterTagGenPrompt: 'Given the following character card and recent chat messages, generate Stable Diffusion tags that describe this character visually. Include appearance, clothing, expression, and any notable features. Return only the comma-separated tags, no explanation.',
    characterTags: {},

    // Cached ComfyUI data
    cachedModels: [],
    cachedVAEs: [],
    cachedSamplers: [],
    cachedSchedulers: [],
    cachedLoRAs: [],
    cacheTimestamp: 0,
};

// Maximum cache age: 1 hour
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

// ── State ─────────────────────────────────────────────────

let isGenerationRunning = false;

// ── Initialisation ────────────────────────────────────────

jQuery(async () => {
    try {
        await loadSettings();

        // Register the wand button in the extensions bar
        registerExtension();

        // Register slash commands
        registerSlashCommands();

        // Register event listeners
        registerEventListeners();

        console.log('[BetterImgGen] Extension initialized successfully');
    } catch (err) {
        console.error('[BetterImgGen] Extension initialization failed:', err);
        toastr?.error?.('Better Image Generation: initialization failed. Check console for details.');
    }
});

// ── Settings ──────────────────────────────────────────────

async function loadSettings() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }

    // Merge defaults for any missing keys
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (extension_settings[SETTINGS_KEY][key] === undefined) {
            extension_settings[SETTINGS_KEY][key] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key]));
        }
    }

    saveSettingsDebounced();
}

function getSettings() {
    return extension_settings[SETTINGS_KEY] || DEFAULT_SETTINGS;
}

function saveSettings() {
    saveSettingsDebounced();
}

// ── Extension Registration ────────────────────────────────

function registerExtension() {
    // Add a button to SillyTavern's wand menu (#extensionsMenu)
    addToWandMenu();
}

function addToWandMenu(retries = 20) {
    // Step 1: wait for #extensionsMenu
    const wandMenu = document.getElementById('extensionsMenu');
    if (!wandMenu) {
        if (retries > 0) {
            setTimeout(() => addToWandMenu(retries - 1), 250);
        } else {
            console.warn('[BetterImgGen] Could not find #extensionsMenu after retries');
        }
        return;
    }

    // Step 2: try to find an existing wand entry that ST may have created for us
    const existingEntry = document.querySelector('#extensionsMenu .list-group-item');
    if (existingEntry) {
        // ST already built an entry — just override its click handler
        existingEntry.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showWandMenuDialog();
        };
        console.log('[BetterImgGen] Hooked into existing wand entry');
        return;
    }

    // Step 3: no existing entry found — create our own list-group-item
    if (document.getElementById(`${EXTENSION_ID}-wand-entry`)) return;

    const html = `
        <div id="${EXTENSION_ID}-wand-entry" class="list-group-item" title="Better Image Generation">
            <span>🎨 Better Image Generation</span>
        </div>
    `;
    wandMenu.insertAdjacentHTML('beforeend', html);

    const el = document.getElementById(`${EXTENSION_ID}-wand-entry`);
    if (el) {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showWandMenuDialog();
        });
    }

    console.log('[BetterImgGen] Added wand entry: Better Image Generation');
}

/**
 * Show a dialog with the three main actions (Configure, Character Tags, Generate Portraits).
 * This avoids fighting ST's wand menu rendering which strips injected .extension_container divs.
 */
function showWandMenuDialog() {
    const dialogHtml = `
        <div id="better-img-gen-wand-dialog" title="Better Image Generation" style="display:none;">
            <div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
                <button class="menu-button" id="bimg-wand-configure" style="padding:10px;font-size:14px;text-align:left;">
                    ⚙ Configure
                </button>
                <button class="menu-button" id="bimg-wand-char-tags" style="padding:10px;font-size:14px;text-align:left;">
                    🤖 Character Tags
                </button>
                <button class="menu-button" id="bimg-wand-portraits" style="padding:10px;font-size:14px;text-align:left;">
                    👥 Generate Portraits
                </button>
            </div>
        </div>
    `;

    $('body').append(dialogHtml);
    const dlg = $('#better-img-gen-wand-dialog').dialog({
        width: 320,
        modal: true,
        close: function () {
            $(this).dialog('destroy').remove();
        },
    });

    document.getElementById('bimg-wand-configure').addEventListener('click', () => {
        dlg.dialog('close');
        openSettingsModal();
    });
    document.getElementById('bimg-wand-char-tags').addEventListener('click', () => {
        dlg.dialog('close');
        openTagGenerationDialog();
    });
    document.getElementById('bimg-wand-portraits').addEventListener('click', () => {
        dlg.dialog('close');
        showCharacterPortraitDialog();
    });
}

// ── Slash Commands ────────────────────────────────────────

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(
        SlashCommand.fromProps({
            name: 'bimg',
            callback: (namedArgs, unnamedArgs) => {
                const mode = (typeof unnamedArgs === 'string' && unnamedArgs.trim()) ? unnamedArgs.trim() : 'Scene';
                triggerGeneration(mode);
                return '';
            },
            helpString: 'Generate an image using Better Image Generation. <mode> - The generation mode name (e.g., Scene, Portrait).',
            unnamedArgumentList: [
                new SlashCommandArgument(
                    'The generation mode name (e.g., Scene, Portrait)',
                    ARGUMENT_TYPE.STRING,
                    false,
                    false,
                    'Scene',
                ),
            ],
            returns: 'void',
        }),
    );

    SlashCommandParser.addCommandObject(
        SlashCommand.fromProps({
            name: 'bimg-character',
            callback: () => {
                showCharacterPortraitDialog();
                return '';
            },
            helpString: 'Open the character portrait dialog to generate images for multiple characters.',
            unnamedArgumentList: [],
            returns: 'void',
        }),
    );
}

// ── Event Listeners ───────────────────────────────────────

function registerEventListeners() {
    // Listen for character list changes to refresh tags display
    $(document).on('characterSelected', () => {
        // Refresh character tags display if modal is open
        refreshCharacterTags();
    });
}

function refreshCharacterTags() {
    // Will fetch current characters and their tags when modal opens
}

// ── Server Proxy Helper ───────────────────────────────────

// Mount point for the extension's server-side router.
// SillyTavern mounts server extensions at /api/plugins/<name>/
const PROXY_BASE = '/api/plugins/st-betterimgen';

// Standalone proxy port (discovered from server)
let standaloneProxyPort = null;
let standaloneProxyDiscovered = false;

/**
 * Discover the standalone proxy port from ST's plugin endpoint.
 * This avoids CSRF issues caused by Cloudflare Zero Trust stripping cookies.
 */
async function discoverProxyPort() {
    if (standaloneProxyDiscovered) return;
    try {
        const response = await fetch(PROXY_BASE + '/proxy-port', { method: 'GET' });
        if (response.ok) {
            const data = await response.json();
            if (data.ok && data.port) {
                standaloneProxyPort = data.port;
                standaloneProxyDiscovered = true;
                console.log('[BetterImgGen] Discovered standalone proxy on port', standaloneProxyPort);
            }
        }
    } catch (err) {
        console.warn('[BetterImgGen] Could not discover standalone proxy port:', err.message);
    }
}

/**
 * Send a request to the ComfyUI proxy endpoint on the SillyTavern server.
 * Uses GET-based proxy only (no CSRF). POST fallback is removed because
 * Cloudflare Zero Trust strips the _csrf cookie, making POST requests
 * impossible. GET bypasses CSRF entirely.
 *
 * @param {string} comfyUrl - The base ComfyUI URL (e.g. http://127.0.0.1:8188)
 * @param {string} endpoint - The ComfyUI endpoint path (e.g. /object_info)
 * @param {object} [options]
 * @param {string} [options.method] - HTTP method (default GET)
 * @param {object} [options.query] - URL query params
 * @param {any} [options.body] - JSON body for POST/PUT
 * @param {boolean} [options.binary] - If true, returns base64 data instead of parsed JSON
 * @returns {Promise<any>} The response data from ComfyUI
 */
async function proxyFetch(comfyUrl, endpoint, { method = 'GET', query, body, binary } = {}) {
    const payload = {
        comfyuiUrl: comfyUrl,
        endpoint: endpoint,
        method: method,
    };

    if (query) payload.query = query;
    if (body !== undefined) payload.body = body;
    if (binary) payload.binary = true;

    // ── GET-based proxy (no CSRF needed) ──────────────────
    const payloadJson = JSON.stringify(payload);
    const proxyEndpoint = `${PROXY_BASE}/proxy?payload=${encodeURIComponent(payloadJson)}`;
    const response = await fetch(proxyEndpoint, {
        method: 'GET',
    });

    const result = await response.json();

    if (!result.ok) {
        throw new Error(result.error || `ComfyUI returned HTTP ${result.status}`);
    }

    return result.data;
}

// ── ComfyUI Connection (Epic 3) ──────────────────────────

async function fetchObjectInfo(comfyUrl) {
    try {
        const data = await proxyFetch(comfyUrl, '/object_info', { method: 'GET' });
        return data;
    } catch (err) {
        throw new Error(`Connection failed: ${err.message}`);
    }
}

/**
 * Parse a ComfyUI object_info field value into an array of option strings.
 *
 * ComfyUI returns combo parameter data in several formats:
 *
 * Format A (unprocessed): comma-separated string + metadata object
 *   ["euler, heun, dpmpp_2m, ...", {"default": "euler"}]
 *   -> Split the first element by comma, return individual values.
 *
 * Format B (checkpoints/VAEs/LoRAs with subfolders):
 *   [["name1.safetensors", ["checkpoints"]], ["name2.safetensors", ["checkpoints"]]]
 *   -> Return first element of each sub-array.
 *
 * Format C (already preprocessed by ComfyUI frontend):
 *   ["euler", "heun", "dpmpp_2m", ...]
 *   -> Return as-is, filtering out non-string items.
 */
function parseComfyField(field) {
    // ComfyUI returns combo parameters in this format:
    //   [["option1", "option2", ...], {"tooltip": "..."}]
    // field[0] is the array of option strings, field[1] is a metadata object.
    // Find the first element that is a non-empty array and return its string contents.
    if (!Array.isArray(field)) return [];
    for (const item of field) {
        if (Array.isArray(item) && item.length > 0) {
            return item.filter(v => typeof v === 'string');
        }
    }
    return [];
}

function extractModels(objectInfo) {
    if (!objectInfo) return [];
    const loader = objectInfo['CheckpointLoaderSimple'] || objectInfo['CheckpointLoader'];
    if (loader && loader.input && loader.input.required) {
        const ckptField = loader.input.required.ckpt_name || loader.input.required.ckpt_path;
        return parseComfyField(ckptField);
    }
    return [];
}

function extractVAEs(objectInfo) {
    if (!objectInfo) return [];
    const loader = objectInfo['VAELoader'] || objectInfo['VAEDecode'];
    if (loader && loader.input && loader.input.required) {
        const vaeField = loader.input.required.vae_name;
        return parseComfyField(vaeField);
    }
    return [];
}

function extractSamplers(objectInfo) {
    if (!objectInfo) return [];
    const sampler = objectInfo['KSampler'];
    if (sampler && sampler.input && sampler.input.required) {
        const nameField = sampler.input.required.sampler_name;
        return parseComfyField(nameField);
    }
    return [];
}

function extractSchedulers(objectInfo) {
    if (!objectInfo) return [];
    const sampler = objectInfo['KSampler'];
    if (sampler && sampler.input && sampler.input.required) {
        const schedField = sampler.input.required.scheduler;
        return parseComfyField(schedField);
    }
    return [];
}

function extractLoRAs(objectInfo) {
    if (!objectInfo) return [];
    const loader = objectInfo['LoraLoader'];
    if (loader && loader.input && loader.input.required) {
        const loraField = loader.input.required.lora_name;
        return parseComfyField(loraField);
    }
    return [];
}

function isCacheValid(settings) {
    if (!settings.cacheTimestamp) return false;
    return (Date.now() - settings.cacheTimestamp) < CACHE_MAX_AGE_MS;
}

async function testConnection(comfyUrl) {
    try {
        const info = await fetchObjectInfo(comfyUrl);
        const s = getSettings();
        s.cachedModels = extractModels(info);
        s.cachedVAEs = extractVAEs(info);
        s.cachedSamplers = extractSamplers(info);
        s.cachedSchedulers = extractSchedulers(info);
        s.cachedLoRAs = extractLoRAs(info);
        s.cacheTimestamp = Date.now();
        saveSettingsDebounced();
        return { success: true, data: s };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function getWorkflowJson() {
    const editor = document.getElementById('better-img-gen-workflow-editor');
    if (editor) return editor.value;
    return getSettings().workflowJson;
}

function validateWorkflowJson(jsonString) {
    try {
        const parsed = JSON.parse(jsonString);
        if (!parsed || typeof parsed !== 'object') {
            return { valid: false, error: 'Workflow must be a JSON object.' };
        }
        return { valid: true, data: parsed };
    } catch (err) {
        return { valid: false, error: 'Invalid JSON: ' + err.message };
    }
}

// ── Prompt Template System (Epic 4) ──────────────────────

function getPromptTemplates() {
    return getSettings().promptTemplates || [];
}

function savePromptTemplate(index, template) {
    const s = getSettings();
    if (index >= 0 && index < s.promptTemplates.length) {
        s.promptTemplates[index] = template;
    } else {
        s.promptTemplates.push(template);
    }
    saveSettingsDebounced();
}

function deletePromptTemplate(index) {
    const s = getSettings();
    if (s.promptTemplates.length <= 1) {
        toastr.warning('Cannot delete the last template.');
        return false;
    }
    if (index >= 0 && index < s.promptTemplates.length) {
        s.promptTemplates.splice(index, 1);
        saveSettingsDebounced();
        return true;
    }
    return false;
}

// ── LoRA Auto-Loading (Epic 5) ──────────────────────────

function getLoraRules() {
    return getSettings().loraRules || [];
}

function saveLoraRules(rules) {
    getSettings().loraRules = rules;
    saveSettingsDebounced();
}

function matchLoraKeywords(prompt, rule) {
    if (!rule.keywords) return false;
    const keywords = rule.keywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
    const promptLower = prompt.toLowerCase();
    return keywords.some(kw => promptLower.includes(kw));
}

function applyLoraReplacement(prompt, rule) {
    if (!rule.keywords) return prompt;
    let result = prompt;
    const keywords = rule.keywords.split(',').map(k => k.trim()).filter(k => k);
    for (const kw of keywords) {
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        if (rule.replacement) {
            result = result.replace(regex, rule.replacement);
        } else {
            result = result.replace(regex, '');
        }
    }
    return result;
}

function findModelOutputNode(workflow) {
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (node.class_type === 'CheckpointLoaderSimple' || node.class_type === 'CheckpointLoader') {
            const outputs = node.outputs || [];
            for (let i = 0; i < outputs.length; i++) {
                const out = outputs[i];
                if (typeof out === 'object' && out.name === 'MODEL') {
                    return { nodeId, outputIndex: i };
                }
                if (out === 'MODEL') {
                    return { nodeId, outputIndex: i };
                }
            }
            // Default: MODEL is first output (index 0)
            return { nodeId, outputIndex: 0 };
        }
    }
    return null;
}

function findClipOutputNode(workflow) {
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (node.class_type === 'CheckpointLoaderSimple' || node.class_type === 'CheckpointLoader') {
            const outputs = node.outputs || [];
            for (let i = 0; i < outputs.length; i++) {
                const out = outputs[i];
                if (typeof out === 'object' && out.name === 'CLIP') {
                    return { nodeId, outputIndex: i };
                }
                if (out === 'CLIP') {
                    return { nodeId, outputIndex: i };
                }
            }
            // CLIP is typically second output (index 1)
            return { nodeId, outputIndex: 1 };
        }
    }
    return null;
}

function injectLoraNode(workflow, loraRule, modelNodeId, modelOutputIndex, clipNodeId, clipOutputIndex, loraIndex) {
    const loraNodeId = `better-img-gen-lora-${loraIndex}`;
    const loraNode = {
        class_type: 'LoraLoader',
        inputs: {
            lora_name: loraRule.model,
            strength_model: 1.0,
            strength_clip: 1.0,
            model: [modelNodeId, modelOutputIndex],
            clip: [clipNodeId, clipOutputIndex],
        },
    };
    workflow[loraNodeId] = loraNode;
    return loraNodeId;
}

function injectLoraChain(workflow, matchedRules) {
    if (!matchedRules || matchedRules.length === 0) return workflow;

    const modelOutput = findModelOutputNode(workflow);
    const clipOutput = findClipOutputNode(workflow);
    if (!modelOutput || !clipOutput) return workflow;

    let currentModelId = modelOutput.nodeId;
    let currentModelOutput = modelOutput.outputIndex;
    let currentClipId = clipOutput.nodeId;
    let currentClipOutput = clipOutput.outputIndex;

    matchedRules.forEach((rule, i) => {
        const loraId = injectLoraNode(
            workflow, rule,
            currentModelId, currentModelOutput,
            currentClipId, currentClipOutput,
            i
        );
        currentModelId = loraId;
        currentModelOutput = 0;
        currentClipId = loraId;
        currentClipOutput = 1;
    });

    return workflow;
}

// ── Character Tag System (Epic 6) ────────────────────────

function getCharacterTags() {
    return getSettings().characterTags || {};
}

function saveCharacterTags(name, tags) {
    getSettings().characterTags[name] = tags;
    saveSettingsDebounced();
}

function deleteCharacterTags(name) {
    delete getSettings().characterTags[name];
    saveSettingsDebounced();
}

function getCharacterTagGenPrompt() {
    return getSettings().characterTagGenPrompt;
}

function saveCharacterTagGenPrompt(prompt) {
    getSettings().characterTagGenPrompt = prompt;
    saveSettingsDebounced();
}

function replaceCharacterPlaceholders(prompt, charTags) {
    if (!prompt || !charTags) return prompt;
    return prompt.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
        const trimmed = name.trim();
        if (charTags[trimmed]) {
            return charTags[trimmed];
        }
        // Leave unmatched placeholders as-is
        return match;
    });
}

// ── Generation Pipeline (Epic 7) ─────────────────────────

function getGenerationModes() {
    return getSettings().generationModes || [];
}

function saveGenerationModes(modes) {
    getSettings().generationModes = modes;
    saveSettingsDebounced();
}

function getChatContext(modeName) {
    // Get recent chat messages from SillyTavern's context
    const context = getContext();
    if (!context || !context.chat) return '';
    const messages = context.chat.slice(-10);
    return messages.map(msg => {
        const role = msg.is_user ? 'User' : msg.name || 'Character';
        return `${role}: ${msg.mes}`;
    }).join('\n');
}

function buildLlmPrompt(template, chatContext) {
    if (template.instruction && chatContext) {
        return template.instruction + '\n\nChat Context:\n' + chatContext;
    }
    return template.instruction || '';
}

async function callLlmForPrompt(llmPrompt) {
    // Use SillyTavern's built-in text completion API
    const context = getContext();
    if (!context || typeof context.generateText !== 'function') {
        throw new Error('SillyTavern chat API not available.');
    }
    try {
        const result = await context.generateText(llmPrompt);
        return result || '';
    } catch (err) {
        throw new Error('LLM generation failed: ' + err.message);
    }
}

function assembleFinalPositivePrompt(llmGeneratedPrompt, charTags, stylePrefix) {
    let prompt = llmGeneratedPrompt || '';
    prompt = replaceCharacterPlaceholders(prompt, charTags);
    if (stylePrefix) {
        prompt = stylePrefix + prompt;
    }
    return prompt;
}

function substitutePlaceholders(workflowJson, settings, positivePrompt, negativePrompt, seed) {
    let result = workflowJson;
    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2147483647) : seed;

    const replacements = {
        '%seed%': String(actualSeed),
        '%steps%': String(settings.steps),
        '%cfg%': String(settings.cfgScale),
        '%sampler%': settings.sampler || 'euler',
        '%scheduler%': settings.scheduler || 'normal',
        '%model%': settings.model || '',
        '%vae%': settings.vae || '',
        '%positive_prompt%': positivePrompt || '',
        '%negative_prompt%': negativePrompt || '',
        '%width%': String(settings.width),
        '%height%': String(settings.height),
        '%denoising_strength%': String(settings.denoisingStrength || 0.7),
        '%clip_skip%': String(settings.clipSkip || 1),
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(placeholder.replace(/%/g, '%'), 'g'), value);
    }

    return result;
}

async function submitToComfyUI(workflowJson, comfyUrl) {
    try {
        const data = await proxyFetch(comfyUrl, '/prompt', {
            method: 'POST',
            body: { prompt: workflowJson },
        });
        if (data.error) throw new Error(data.error.message || data.error);
        return data.prompt_id;
    } catch (err) {
        throw new Error(`ComfyUI submit failed: ${err.message}`);
    }
}

async function pollForResult(promptId, comfyUrl) {
    const maxAttempts = 300; // 5 minutes at 1s intervals
    const delay = 1000;

    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        try {
            const data = await proxyFetch(comfyUrl, '/history/' + promptId, {
                method: 'GET',
            });
            const history = data[promptId];
            if (history && history.outputs) {
                const outputs = history.outputs;
                for (const nodeId of Object.keys(outputs)) {
                    const nodeOutputs = outputs[nodeId];
                    if (nodeOutputs.images && nodeOutputs.images.length > 0) {
                        const image = nodeOutputs.images[0];
                        return {
                            filename: image.filename || image.name,
                            subfolder: image.subfolder || '',
                            type: image.type || 'output',
                        };
                    }
                }
            }
            if (history && history.status && history.status.completed === false) {
                throw new Error('Generation failed on ComfyUI side.');
            }
        } catch (err) {
            if (err.message.includes('Generation failed')) throw err;
            // Continue polling
        }
    }
    throw new Error('ComfyUI generation timed out.');
}

async function fetchGeneratedImage(imageInfo, comfyUrl) {
    // Fetch the generated image via the GET-based proxy (no CSRF).
    try {
        const data = await proxyFetch(comfyUrl, '/view', {
            method: 'GET',
            query: {
                filename: imageInfo.filename,
                subfolder: imageInfo.subfolder,
                type: imageInfo.type,
            },
            binary: true,
        });

        // Decode base64 to binary
        const binaryStr = atob(data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        return new Blob([bytes], { type: 'image/png' });
    } catch (err) {
        throw new Error(`Failed to fetch generated image: ${err.message}`);
    }
}

async function saveImageToStorage(imageBlob) {
    // Convert blob to base64 data URL
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(imageBlob);
    });
}

async function postImageToChat(imageDataUrl, prompt, seed) {
    // Post as an image message to the chat
    const context = getContext();
    if (!context) return;

    // Create a message with the image
    const imageHtml = `<img src="${imageDataUrl}" alt="Generated Image" class="better-img-gen-generated-image" data-prompt="${escapeHtml(prompt)}" data-seed="${seed}" style="max-width:100%;border-radius:4px;">`;
    const messageText = `**Generated Image**\nPrompt: ${prompt}\nSeed: ${seed}`;

    context.addOneMessage({
        mes: messageText + '\n' + imageHtml,
        name: 'BetterImgGen',
        is_user: false,
        is_system: true,
        force_avatar: 'fa-wand-sparkles',
    });
}

// ── Generation Orchestrator ───────────────────────────────

let generationHistory = [];

async function generateImage(modeName, characterOverride) {
    if (isGenerationRunning) {
        toastr.warning('A generation is already in progress.');
        return;
    }

    const s = getSettings();
    if (!s.comfyuiUrl) {
        toastr.error('Please configure the ComfyUI URL in settings first.');
        return;
    }

    isGenerationRunning = true;
    toastr.info('Generating...');

    try {
        // 1. Find the generation mode
        const modes = getGenerationModes();
        const mode = modes.find(m => m.name === modeName) || modes[0];
        const templateIndex = mode ? mode.promptTemplateIndex : 0;
        const templates = getPromptTemplates();
        const template = templates[templateIndex] || templates[0];

        // 2. If a character override is provided, replace [[character]] in the template instruction
        let effectiveInstruction = template.instruction;
        if (characterOverride) {
            effectiveInstruction = effectiveInstruction.replace(/\[\[character\]\]/gi, characterOverride);
        }

        // 3. Get chat context
        const chatContext = template.name === 'No Context' ? '' : getChatContext(modeName);

        // 4. Build LLM prompt using the (possibly modified) instruction
        const effectiveTemplate = { ...template, instruction: effectiveInstruction };
        const llmPrompt = buildLlmPrompt(effectiveTemplate, chatContext);

        // 4. Call LLM for SD prompt
        let sdPrompt = '';
        if (llmPrompt) {
            sdPrompt = await callLlmForPrompt(llmPrompt);
        }

        // 5. Edit prompt before generation if enabled
        if (s.editBeforeGenerate && sdPrompt) {
            const edited = await showPromptEditor(sdPrompt);
            if (edited === null) {
                isGenerationRunning = false;
                toastr.info('Generation cancelled.');
                return;
            }
            sdPrompt = edited;
        }

        // 6. Assemble final positive prompt with character tags and style prefix
        const charTags = getCharacterTags();
        const finalPrompt = assembleFinalPositivePrompt(sdPrompt, charTags, s.stylePrefix);

        // 7. Apply LoRA keyword matching and replacement
        const loraRules = getLoraRules();
        const matchedRules = [];
        let loraPrompt = finalPrompt;
        for (const rule of loraRules) {
            if (matchLoraKeywords(loraPrompt, rule)) {
                matchedRules.push(rule);
                loraPrompt = applyLoraReplacement(loraPrompt, rule);
            }
        }

        // 8. Get workflow JSON
        const workflowStr = getWorkflowJson();
        if (!workflowStr) {
            throw new Error('No workflow JSON configured.');
        }
        const validated = validateWorkflowJson(workflowStr);
        if (!validated.valid) {
            throw new Error('Invalid workflow JSON: ' + validated.error);
        }

        // 9. Substitute placeholders
        let workflow = substitutePlaceholders(
            workflowStr, s, loraPrompt, s.negativePrompt, s.seed
        );

        // 10. Inject LoRA nodes into workflow
        let finalWorkflow = JSON.parse(workflow);
        finalWorkflow = injectLoraChain(finalWorkflow, matchedRules);
        const finalWorkflowStr = JSON.stringify(finalWorkflow);

        // 11. Submit to ComfyUI
        const promptId = await submitToComfyUI(finalWorkflowStr, s.comfyuiUrl);

        // 12. Poll for result
        const imageInfo = await pollForResult(promptId, s.comfyuiUrl);

        // 13. Fetch the image
        const imageBlob = await fetchGeneratedImage(imageInfo, s.comfyuiUrl);

        // 14. Save and post to chat
        const imageDataUrl = await saveImageToStorage(imageBlob);
        const actualSeed = s.seed === -1 ? Math.floor(Math.random() * 2147483647) : s.seed;
        await postImageToChat(imageDataUrl, loraPrompt, actualSeed);

        // 15. Store in generation history for swiping
        generationHistory.push({
            imagePath: imageDataUrl,
            prompt: loraPrompt,
            seed: actualSeed,
            timestamp: Date.now(),
        });

        toastr.success('Image generated!');
    } catch (err) {
        toastr.error('Generation failed: ' + err.message);
        console.error('[BetterImgGen]', err);
    } finally {
        isGenerationRunning = false;
    }
}

async function showPromptEditor(prompt) {
    return new Promise((resolve) => {
        const editorHtml = `
            <div id="better-img-gen-prompt-editor" title="Edit Prompt Before Generation">
                <div style="padding:12px;">
                    <p style="color:#8a7a60;margin-bottom:8px;">Edit the generated prompt below:</p>
                    <textarea id="better-img-gen-prompt-edit-textarea"
                              style="width:100%;min-height:100px;background:#2f2a26;color:#d4c4a8;
                                     border:1px solid #5a4a3a;border-radius:3px;padding:8px;
                                     font-family:Cascadia Code,Consolas,monospace;font-size:12px;
                                     resize:vertical;box-sizing:border-box;">${escapeHtml(prompt)}</textarea>
                </div>
            </div>
        `;

        $('body').append(editorHtml);
        const dlg = $('#better-img-gen-prompt-editor').dialog({
            width: 600,
            modal: true,
            buttons: [
                {
                    text: 'Send to ComfyUI',
                    class: 'menu-button',
                    click: function() {
                        const val = $('#better-img-gen-prompt-edit-textarea').val();
                        $(this).dialog('destroy').remove();
                        resolve(val);
                    }
                },
                {
                    text: 'Cancel',
                    class: 'menu-button',
                    click: function() {
                        $(this).dialog('destroy').remove();
                        resolve(null);
                    }
                }
            ],
            close: function() {
                $(this).dialog('destroy').remove();
                resolve(null);
            }
        });
    });
}

// ── Wand Menu (Epic 8) ──────────────────────────────────
// Extension buttons are registered directly in addToWandMenu() above.

function openTagGenerationDialog() {
    const dialogHtml = `
        <div id="better-img-gen-tag-dialog" title="Generate Character Tags">
            <div style="padding:12px;">
                <div class="better-img-gen-field" style="margin-bottom:12px;">
                    <label>Character Name</label>
                    <input type="text" class="better-img-gen-input" id="better-img-gen-tag-char-name"
                           placeholder="Enter character name">
                </div>
                <button class="better-img-gen-btn better-img-gen-btn-primary" id="better-img-gen-tag-generate-btn"
                        style="width:100%;">Generate Tags</button>
            </div>
        </div>
    `;

    $('body').append(dialogHtml);
    const dlg = $('#better-img-gen-tag-dialog').dialog({
        width: 400,
        modal: true,
        close: function() { $(this).dialog('destroy').remove(); }
    });

    document.getElementById('better-img-gen-tag-generate-btn').addEventListener('click', async () => {
        const charName = document.getElementById('better-img-gen-tag-char-name').value.trim();
        if (!charName) {
            toastr.warning('Please enter a character name.');
            return;
        }

        try {
            const context = getContext();
            let charCard = '';
            let chatMessages = '';

            if (context && context.characters) {
                const char = context.characters.find(c =>
                    c.name.toLowerCase() === charName.toLowerCase()
                );
                if (char) {
                    charCard = char.description || char.data?.description || '';
                }
            }

            chatMessages = getChatContext('');

            const genPrompt = getCharacterTagGenPrompt();
            const fullPrompt = genPrompt + '\n\nCharacter: ' + charName + '\nDescription: ' + charCard + '\n\nChat:\n' + chatMessages;
            const tags = await callLlmForPrompt(fullPrompt);

            saveCharacterTags(charName, tags.trim());
            toastr.success(`Tags generated for ${charName}`);
            dlg.dialog('close');
        } catch (err) {
            toastr.error('Tag generation failed: ' + err.message);
        }
    });
}

// ── Character Portrait Batch Generation ──────────────────

/**
 * Show a dialog for entering character names to generate portraits for.
 */
function showCharacterPortraitDialog() {
    const modes = getGenerationModes();
    const modeOptions = modes.map((m, i) =>
        `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.description ? ' — ' + escapeHtml(m.description) : ''}</option>`
    ).join('');

    const dialogHtml = `
        <div id="better-img-gen-char-portrait-dialog" title="Character Portraits">
            <div style="padding:12px;">
                <div class="better-img-gen-field" style="margin-bottom:12px;">
                    <label>Character Names</label>
                    <input type="text" class="better-img-gen-input" id="better-img-gen-char-portrait-names"
                           placeholder="Enter character names separated by spaces (e.g. Alice Bob Charlie)">
                    <div style="color:#8a7a60;font-size:11px;margin-top:4px;">First names only, space-separated.</div>
                </div>
                <div class="better-img-gen-field" style="margin-bottom:12px;">
                    <label>Generation Mode</label>
                    <select class="better-img-gen-select" id="better-img-gen-char-portrait-mode">
                        ${modeOptions}
                    </select>
                </div>
                <button class="better-img-gen-btn better-img-gen-btn-primary" id="better-img-gen-char-portrait-generate-btn"
                        style="width:100%;">Generate Portraits</button>
            </div>
        </div>
    `;

    $('body').append(dialogHtml);
    const dlg = $('#better-img-gen-char-portrait-dialog').dialog({
        width: 450,
        modal: true,
        close: function() { $(this).dialog('destroy').remove(); }
    });

    document.getElementById('better-img-gen-char-portrait-generate-btn').addEventListener('click', async () => {
        const namesStr = document.getElementById('better-img-gen-char-portrait-names').value.trim();
        if (!namesStr) {
            toastr.warning('Please enter at least one character name.');
            return;
        }

        const names = namesStr.split(/\s+/).filter(n => n.length > 0);
        const modeSelect = document.getElementById('better-img-gen-char-portrait-mode');
        const modeName = modeSelect.value;

        dlg.dialog('close');
        await generateCharacterPortraits(names, modeName);
    });
}

/**
 * Generate images for multiple characters by iterating through each name
 * and replacing [[character]] in the prompt template instruction.
 * @param {string[]} characterNames - Array of character first names
 * @param {string} modeName - Generation mode name
 */
async function generateCharacterPortraits(characterNames, modeName) {
    const total = characterNames.length;

    for (let i = 0; i < total; i++) {
        const name = characterNames[i];
        toastr.info(`Generating portrait ${i + 1}/${total}: ${name}`);
        await generateImage(modeName, name);
    }

    toastr.success(`Finished generating ${total} portrait(s).`);
}

// ── Generation Pipeline Wrapper ──────────────────────────

function triggerGeneration(mode) {
    generateImage(mode);
}

// ── Settings Modal (Epic 2) ────────────────────────────────

let settingsModal = null;

function openSettingsModal() {
    if (settingsModal) {
        settingsModal.dialog('open');
        return;
    }

    const modalId = 'better-img-gen-modal';
    const html = `
        <div id="${modalId}" title="Better Image Generation Settings" class="better-img-gen-modal">
            <div class="better-img-gen-modal-layout">
                <div class="better-img-gen-sidebar">
                    <div class="better-img-gen-sidebar-item active" data-panel="main-config">
                        <span class="better-img-gen-sidebar-icon">⚙</span>
                        <span>Main Config</span>
                    </div>
                    <div class="better-img-gen-sidebar-item" data-panel="prompts">
                        <span class="better-img-gen-sidebar-icon">💬</span>
                        <span>Prompts</span>
                    </div>
                    <div class="better-img-gen-sidebar-item" data-panel="lora">
                        <span class="better-img-gen-sidebar-icon">🎨</span>
                        <span>LoRA Handling</span>
                    </div>
                    <div class="better-img-gen-sidebar-item" data-panel="characters">
                        <span class="better-img-gen-sidebar-icon">👤</span>
                        <span>Characters</span>
                    </div>
                </div>
        <div class="better-img-gen-content">
                    <div class="better-img-gen-panel" id="better-img-gen-panel-main-config">
                        ${buildMainConfigPanel()}
                    </div>
                    <div class="better-img-gen-panel hidden" id="better-img-gen-panel-prompts">
                        ${buildPromptsPanel()}
                    </div>
                    <div class="better-img-gen-panel hidden" id="better-img-gen-panel-lora">
                        ${buildLoraPanel()}
                    </div>
                    <div class="better-img-gen-panel hidden" id="better-img-gen-panel-characters">
                        ${buildCharactersPanel()}
                    </div>
                </div>
            </div>
            <div class="better-img-gen-footer">
                <div class="better-img-gen-pipeline-hint">
                    Chat → LLM → [[replace]] → Style Prefix → ComfyUI
                </div>
                <div class="better-img-gen-footer-actions">
                    <button class="menu-button better-img-gen-import-btn" id="better-img-gen-import-btn">Import</button>
                    <button class="menu-button better-img-gen-export-btn" id="better-img-gen-export-btn">Export</button>
                    <button class="menu-button better-img-gen-save-btn" id="better-img-gen-save-btn">Save All Settings</button>
                </div>
            </div>
        </div>
    `;

    // Append modal HTML to body
    document.body.insertAdjacentHTML('beforeend', html);

    // Create jQuery UI dialog
    settingsModal = $(`#${modalId}`).dialog({
        title: 'Better Image Generation Settings',
        width: 900,
        height: 650,
        modal: true,
        draggable: true,
        resizable: true,
        autoOpen: true,
        close: () => {
            // Save on close
            saveSettingsDebounced();
        },
    });

    // Wire sidebar navigation
    $(`#${modalId}`).on('click', '.better-img-gen-sidebar-item', function () {
        const panel = $(this).data('panel');
        $(this).closest('.better-img-gen-sidebar').find('.better-img-gen-sidebar-item').removeClass('active');
        $(this).addClass('active');
        $(`#${modalId}`).find('.better-img-gen-panel').addClass('hidden');
        $(`#better-img-gen-panel-${panel}`).removeClass('hidden');
    });

    // Wire import button
    document.getElementById('better-img-gen-import-btn').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                importSettings(e.target.files[0]);
            }
        });
        input.click();
    });

    // Wire export button
    document.getElementById('better-img-gen-export-btn').addEventListener('click', exportSettings);

    // Wire save button
    document.getElementById('better-img-gen-save-btn').addEventListener('click', () => {
        saveSettingsDebounced();
        toastr.success('Settings saved.');
    });

    // ── Wire all modal interactions ─────────────────────

    // Connection: Test
    document.getElementById('better-img-gen-test-connection').addEventListener('click', async () => {
        const btn = document.getElementById('better-img-gen-test-connection');
        const urlInput = document.getElementById('better-img-gen-comfyui-url');
        const url = urlInput.value.trim();
        if (!url) {
            toastr.warning('Please enter a ComfyUI URL.');
            return;
        }
        // Save URL
        getSettings().comfyuiUrl = url;

        btn.disabled = true;
        btn.textContent = 'Testing...';
        try {
            const result = await testConnection(url);
            if (result.success) {
                toastr.success('Connection successful! Cached ' + result.data.cachedModels.length + ' models, ' + result.data.cachedLoRAs.length + ' LoRAs.');
                // Refresh dropdowns
                refreshSettingsDropdowns();
            } else {
                toastr.error('Connection failed: ' + result.error);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = 'Test Connection';
        }
    });

    // Workflow: Load from file
    document.getElementById('better-img-gen-load-workflow').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const editor = document.getElementById('better-img-gen-workflow-editor');
                    editor.value = ev.target.result;
                    getSettings().workflowJson = ev.target.result;
                    saveSettingsDebounced();
                };
                reader.readAsText(e.target.files[0]);
            }
        });
        input.click();
    });

    // Workflow: Paste from clipboard
    document.getElementById('better-img-gen-paste-workflow').addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            const editor = document.getElementById('better-img-gen-workflow-editor');
            editor.value = text;
            getSettings().workflowJson = text;
            saveSettingsDebounced();
            toastr.success('Workflow pasted from clipboard.');
        } catch (err) {
            toastr.error('Could not read clipboard: ' + err.message);
        }
    });

    // Workflow: Save to file
    document.getElementById('better-img-gen-save-workflow').addEventListener('click', () => {
        const editor = document.getElementById('better-img-gen-workflow-editor');
        const blob = new Blob([editor.value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Workflow: Auto-save on edit
    document.getElementById('better-img-gen-workflow-editor').addEventListener('input', () => {
        getSettings().workflowJson = document.getElementById('better-img-gen-workflow-editor').value;
    });

    // Placeholder reference: click to insert
    document.getElementById('better-img-gen-placeholder-ref').addEventListener('click', (e) => {
        const item = e.target.closest('.better-img-gen-ref-item');
        if (item) {
            const placeholder = item.dataset.placeholder;
            const editor = document.getElementById('better-img-gen-workflow-editor');
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + placeholder + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + placeholder.length;
            editor.focus();
            getSettings().workflowJson = editor.value;
        }
    });

    // Generation Settings: auto-save on change
    setupAutoSaveInput('better-img-gen-comfyui-url', 'comfyuiUrl');
    setupAutoSaveInput('better-img-gen-steps', 'steps', Number);
    setupAutoSaveInput('better-img-gen-cfg', 'cfgScale', Number);
    setupAutoSaveInput('better-img-gen-width', 'width', Number);
    setupAutoSaveInput('better-img-gen-height', 'height', Number);
    setupAutoSaveInput('better-img-gen-denoising', 'denoisingStrength', Number);
    setupAutoSaveInput('better-img-gen-seed', 'seed', Number);
    setupAutoSaveInput('better-img-gen-clip-skip', 'clipSkip', Number);
    setupAutoSaveSelect('better-img-gen-model', 'model');
    setupAutoSaveSelect('better-img-gen-vae', 'vae');
    setupAutoSaveSelect('better-img-gen-sampler', 'sampler');
    setupAutoSaveSelect('better-img-gen-scheduler', 'scheduler');
    setupAutoSaveTextarea('better-img-gen-style-prefix', 'stylePrefix');
    setupAutoSaveTextarea('better-img-gen-negative-prompt', 'negativePrompt');
    setupAutoSaveCheckbox('better-img-gen-edit-before-gen', 'editBeforeGenerate');

    // Character tag gen prompt: auto-save
    document.getElementById('better-img-gen-char-tag-gen-prompt').addEventListener('input', () => {
        getSettings().characterTagGenPrompt = document.getElementById('better-img-gen-char-tag-gen-prompt').value;
        saveSettingsDebounced();
    });

    // Prompts: expandable cards
    $(`#${modalId}`).on('click', '.better-img-gen-card-header', function () {
        $(this).closest('.better-img-gen-card').toggleClass('expanded');
    });

    // Prompts: New Template
    document.getElementById('better-img-gen-new-template').addEventListener('click', () => {
        const s = getSettings();
        s.promptTemplates.push({ name: 'New Template', instruction: '' });
        saveSettingsDebounced();
        // Refresh the prompts panel
        const panel = document.getElementById('better-img-gen-panel-prompts');
        panel.innerHTML = buildPromptsPanel();
        wirePromptsPanelEvents(modalId);
    });

    // Prompts: Save and Delete (delegated)
    wirePromptsPanelEvents(modalId);

    // LoRA: Add rule
    document.getElementById('better-img-gen-add-lora-rule').addEventListener('click', () => {
        const s = getSettings();
        s.loraRules.push({ keywords: '', model: '', replacement: '' });
        saveSettingsDebounced();
        const panel = document.getElementById('better-img-gen-panel-lora');
        panel.innerHTML = buildLoraPanel();
        wireLoraPanelEvents();
    });

    // LoRA: Remove rule (delegated)
    wireLoraPanelEvents();

    // Characters: wire tag operations (delegated)
    wireCharacterPanelEvents();
}

function wirePromptsPanelEvents(modalId) {
    // Template Save buttons
    $(`#${modalId}`).off('click', '.better-img-gen-template-save').on('click', '.better-img-gen-template-save', function () {
        const card = $(this).closest('.better-img-gen-card');
        const index = parseInt(card.data('template-index'));
        const name = card.find('.better-img-gen-template-name').val().trim();
        const instruction = card.find('.better-img-gen-template-instruction').val().trim();
        if (!name) { toastr.warning('Template name is required.'); return; }
        savePromptTemplate(index, { name, instruction });
        toastr.success('Template saved.');
    });

    // Template Delete buttons
    $(`#${modalId}`).off('click', '.better-img-gen-template-delete').on('click', '.better-img-gen-template-delete', function () {
        const card = $(this).closest('.better-img-gen-card');
        const index = parseInt(card.data('template-index'));
        if (confirm('Delete this template?')) {
            if (deletePromptTemplate(index)) {
                const panel = document.getElementById('better-img-gen-panel-prompts');
                panel.innerHTML = buildPromptsPanel();
                wirePromptsPanelEvents(modalId);
            }
        }
    });
}

function wireLoraPanelEvents() {
    // LoRA: Remove rule
    document.querySelectorAll('.better-img-gen-lora-remove').forEach(btn => {
        btn.addEventListener('click', function () {
            const row = this.closest('.better-img-gen-inline-row');
            const index = parseInt(row.dataset.loraIndex);
            const s = getSettings();
            s.loraRules.splice(index, 1);
            saveSettingsDebounced();
            const panel = document.getElementById('better-img-gen-panel-lora');
            panel.innerHTML = buildLoraPanel();
            wireLoraPanelEvents();
        });
    });

    // LoRA: Auto-save field changes
    document.querySelectorAll('.better-img-gen-lora-keywords').forEach((el, i) => {
        el.addEventListener('input', () => {
            const s = getSettings();
            if (s.loraRules[i]) s.loraRules[i].keywords = el.value;
            saveSettingsDebounced();
        });
    });
    document.querySelectorAll('.better-img-gen-lora-model').forEach((el, i) => {
        el.addEventListener('change', () => {
            const s = getSettings();
            if (s.loraRules[i]) s.loraRules[i].model = el.value;
            saveSettingsDebounced();
        });
    });
    document.querySelectorAll('.better-img-gen-lora-replacement').forEach((el, i) => {
        el.addEventListener('input', () => {
            const s = getSettings();
            if (s.loraRules[i]) s.loraRules[i].replacement = el.value;
            saveSettingsDebounced();
        });
    });
}

function wireCharacterPanelEvents() {
    // Character: Save Tags
    document.querySelectorAll('.better-img-gen-char-tags-save').forEach(btn => {
        btn.addEventListener('click', function () {
            const card = this.closest('.better-img-gen-card');
            const name = card.dataset.charName;
            const tags = card.querySelector('.better-img-gen-char-tags').value;
            saveCharacterTags(name, tags);
            toastr.success('Tags saved for ' + name);
        });
    });

    // Character: Generate from LLM
    document.querySelectorAll('.better-img-gen-char-tags-generate').forEach(btn => {
        btn.addEventListener('click', function () {
            const card = this.closest('.better-img-gen-card');
            const name = card.dataset.charName;
            // Trigger the tag generation dialog pre-filled
            const existingDialog = document.getElementById('better-img-gen-tag-dialog');
            if (existingDialog) $(existingDialog).dialog('destroy').remove();
            openTagGenerationDialog(name);
        });
    });

    // Character: Clear Tags
    document.querySelectorAll('.better-img-gen-char-tags-clear').forEach(btn => {
        btn.addEventListener('click', function () {
            const card = this.closest('.better-img-gen-card');
            const name = card.dataset.charName;
            if (confirm('Clear tags for ' + name + '?')) {
                deleteCharacterTags(name);
                const panel = document.getElementById('better-img-gen-panel-characters');
                panel.innerHTML = buildCharactersPanel();
                wireCharacterPanelEvents();
                toastr.success('Tags cleared for ' + name);
            }
        });
    });
}

function refreshSettingsDropdowns() {
    const s = getSettings();
    const modelSelect = document.getElementById('better-img-gen-model');
    if (modelSelect) {
        const current = modelSelect.value;
        modelSelect.innerHTML = '<option value="">\u2014 Select \u2014</option>' + getOptions(s.cachedModels, current);
        modelSelect.value = current || '';
    }
    const vaeSelect = document.getElementById('better-img-gen-vae');
    if (vaeSelect) {
        const current = vaeSelect.value;
        vaeSelect.innerHTML = '<option value="">\u2014 None \u2014</option>' + getOptions(s.cachedVAEs, current);
        vaeSelect.value = current || '';
    }
    const samplerSelect = document.getElementById('better-img-gen-sampler');
    if (samplerSelect) {
        const current = samplerSelect.value;
        samplerSelect.innerHTML = '<option value="">\u2014 Default \u2014</option>' + getOptions(s.cachedSamplers, current);
        samplerSelect.value = current || '';
    }
    const schedulerSelect = document.getElementById('better-img-gen-scheduler');
    if (schedulerSelect) {
        const current = schedulerSelect.value;
        schedulerSelect.innerHTML = '<option value="">\u2014 Default \u2014</option>' + getOptions(s.cachedSchedulers, current);
        schedulerSelect.value = current || '';
    }
}

function setupAutoSaveInput(id, key, transform) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        let val = el.value;
        if (transform === Number) val = parseFloat(val) || 0;
        getSettings()[key] = val;
        saveSettingsDebounced();
    });
}

function setupAutoSaveSelect(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
        getSettings()[key] = el.value;
        saveSettingsDebounced();
    });
}

function setupAutoSaveTextarea(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
        getSettings()[key] = el.value;
        saveSettingsDebounced();
    });
}

function setupAutoSaveCheckbox(id, key) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
        getSettings()[key] = el.checked;
        saveSettingsDebounced();
    });
}

// ── Panel Builders ─────────────────────────────────────────

const PLACEHOLDERS = [
    '%seed%', '%steps%', '%cfg%', '%sampler%', '%scheduler%',
    '%model%', '%vae%', '%positive_prompt%', '%negative_prompt%',
    '%width%', '%height%', '%denoising_strength%', '%clip_skip%',
];

function buildMainConfigPanel() {
    const s = getSettings();
    return `
        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">🔗 Connection</div>
            <div class="better-img-gen-connection-row">
                <input type="text" class="better-img-gen-input" id="better-img-gen-comfyui-url"
                       value="${escapeHtml(s.comfyuiUrl)}" placeholder="http://127.0.0.1:8188">
                <button class="better-img-gen-btn" id="better-img-gen-test-connection">Test Connection</button>
            </div>
        </div>

        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">📄 Workflow JSON</div>
            <div class="better-img-gen-section-subtitle">Load a workflow JSON file from ComfyUI, or paste directly. Use %placeholders% for dynamic values.</div>
            <div class="better-img-gen-workflow-actions">
                <button class="better-img-gen-btn" id="better-img-gen-load-workflow">📂 Load</button>
                <button class="better-img-gen-btn" id="better-img-gen-paste-workflow">📋 Paste</button>
                <button class="better-img-gen-btn" id="better-img-gen-save-workflow">💾 Save to File</button>
            </div>
            <textarea class="better-img-gen-textarea" id="better-img-gen-workflow-editor"
                      rows="8" placeholder='Paste or load workflow JSON here...'>${escapeHtml(s.workflowJson)}</textarea>
            <div class="better-img-gen-section-subtitle" style="margin-top:4px;">Available placeholders (click to insert):</div>
            <div class="better-img-gen-ref-panel" id="better-img-gen-placeholder-ref">
                ${PLACEHOLDERS.map(p => `<div class="better-img-gen-ref-item" data-placeholder="${p}"><code>${p}</code></div>`).join('')}
            </div>
        </div>

        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">⚙ Generation Settings</div>
            <div class="better-img-gen-settings-grid">
                <div class="better-img-gen-field">
                    <label>Model</label>
                    <select class="better-img-gen-select" id="better-img-gen-model">
                        <option value="">— Select —</option>
                        ${getOptions(s.cachedModels, s.model)}
                    </select>
                </div>
                <div class="better-img-gen-field">
                    <label>VAE</label>
                    <select class="better-img-gen-select" id="better-img-gen-vae">
                        <option value="">— None —</option>
                        ${getOptions(s.cachedVAEs, s.vae)}
                    </select>
                </div>
                <div class="better-img-gen-field">
                    <label>Sampler</label>
                    <select class="better-img-gen-select" id="better-img-gen-sampler">
                        <option value="">— Default —</option>
                        ${getOptions(s.cachedSamplers, s.sampler)}
                    </select>
                </div>
                <div class="better-img-gen-field">
                    <label>Scheduler</label>
                    <select class="better-img-gen-select" id="better-img-gen-scheduler">
                        <option value="">— Default —</option>
                        ${getOptions(s.cachedSchedulers, s.scheduler)}
                    </select>
                </div>
                <div class="better-img-gen-field">
                    <label>Steps</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-steps"
                           value="${s.steps}" min="1" max="150">
                </div>
                <div class="better-img-gen-field">
                    <label>CFG Scale</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-cfg"
                           value="${s.cfgScale}" min="1" max="30" step="0.5">
                </div>
                <div class="better-img-gen-field">
                    <label>Width</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-width"
                           value="${s.width}" min="64" max="2048" step="64">
                </div>
                <div class="better-img-gen-field">
                    <label>Height</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-height"
                           value="${s.height}" min="64" max="2048" step="64">
                </div>
                <div class="better-img-gen-field">
                    <label>Denoising Strength</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-denoising"
                           value="${s.denoisingStrength}" min="0" max="1" step="0.05">
                </div>
                <div class="better-img-gen-field">
                    <label>Seed (-1 = random)</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-seed"
                           value="${s.seed}" min="-1" max="2147483647">
                </div>
                <div class="better-img-gen-field">
                    <label>CLIP Skip</label>
                    <input type="number" class="better-img-gen-input" id="better-img-gen-clip-skip"
                           value="${s.clipSkip}" min="1" max="12">
                </div>
            </div>
        </div>

        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">✏ Prompt Modifiers</div>
            <div class="better-img-gen-field" style="margin-bottom:8px;">
                <label>Style Prefix (prepended to every positive prompt)</label>
                <textarea class="better-img-gen-textarea" id="better-img-gen-style-prefix" rows="2">${escapeHtml(s.stylePrefix)}</textarea>
            </div>
            <div class="better-img-gen-field" style="margin-bottom:8px;">
                <label>Global Negative Prompt</label>
                <textarea class="better-img-gen-textarea" id="better-img-gen-negative-prompt" rows="2">${escapeHtml(s.negativePrompt)}</textarea>
            </div>
            <label class="better-img-gen-checkbox">
                <input type="checkbox" id="better-img-gen-edit-before-gen" ${s.editBeforeGenerate ? 'checked' : ''}>
                Edit prompts before generation (shows confirmation dialog)
            </label>
        </div>
    `;
}

function buildPromptsPanel() {
    const s = getSettings();
    const templates = s.promptTemplates || [];
    let cardsHtml = templates.map((t, i) => `
        <div class="better-img-gen-card" data-template-index="${i}">
            <div class="better-img-gen-card-header">
                <span class="better-img-gen-card-title">${escapeHtml(t.name)}</span>
                <span class="better-img-gen-card-toggle">▶</span>
            </div>
            <div class="better-img-gen-card-body">
                <div class="better-img-gen-field" style="margin-bottom:8px;">
                    <label>Template Name</label>
                    <input type="text" class="better-img-gen-input better-img-gen-template-name"
                           value="${escapeHtml(t.name)}" placeholder="Template name">
                </div>
                <div class="better-img-gen-field" style="margin-bottom:8px;">
                    <label>LLM Instruction</label>
                    <textarea class="better-img-gen-textarea better-img-gen-template-instruction" rows="4"
                              placeholder="Enter LLM instruction for prompt generation...">${escapeHtml(t.instruction)}</textarea>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="better-img-gen-btn better-img-gen-btn-primary better-img-gen-template-save">Save</button>
                    <button class="better-img-gen-btn better-img-gen-btn-danger better-img-gen-template-delete">Delete</button>
                </div>
            </div>
        </div>
    `).join('');

    return `
        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">💬 Prompt Templates</div>
            <div class="better-img-gen-section-subtitle">Templates convert chat context into Stable Diffusion prompts via the active LLM.</div>
            <button class="better-img-gen-btn better-img-gen-btn-primary" id="better-img-gen-new-template" style="margin-bottom:8px;">+ New Template</button>
            <div id="better-img-gen-template-list">
                ${cardsHtml || '<p style="color:#8a7a60;">No templates yet. Click "New Template" to create one.</p>'}
            </div>
        </div>
    `;
}

function buildLoraPanel() {
    const s = getSettings();
    const rules = s.loraRules || [];
    let rowsHtml = rules.map((rule, i) => `
        <div class="better-img-gen-inline-row" data-lora-index="${i}">
            <input type="text" class="better-img-gen-input better-img-gen-lora-keywords"
                   value="${escapeHtml(rule.keywords)}" placeholder="keyword1, keyword2">
            <select class="better-img-gen-select better-img-gen-lora-model">
                <option value="">— Select LoRA —</option>
                ${getOptions(s.cachedLoRAs, rule.model)}
            </select>
            <input type="text" class="better-img-gen-input better-img-gen-lora-replacement"
                   value="${escapeHtml(rule.replacement || '')}" placeholder="Replacement text (optional)">
            <button class="better-img-gen-btn better-img-gen-btn-danger better-img-gen-lora-remove">✕</button>
        </div>
    `).join('');

    return `
        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">🎨 LoRA Auto-Loading Rules</div>
            <div class="better-img-gen-section-subtitle">When prompt keywords match, the corresponding LoRA is automatically injected into the workflow.</div>
            <div id="better-img-gen-lora-list">
                ${rowsHtml || '<p style="color:#8a7a60;">No LoRA rules yet. Click "+ Add LoRA Rule" to create one.</p>'}
            </div>
            <button class="better-img-gen-btn better-img-gen-btn-primary" id="better-img-gen-add-lora-rule">+ Add LoRA Rule</button>
        </div>
    `;
}

function buildCharactersPanel() {
    const s = getSettings();
    const charTags = s.characterTags || {};
    const charNames = Object.keys(charTags);
    let charCardsHtml = charNames.map(name => `
        <div class="better-img-gen-card" data-char-name="${escapeHtml(name)}">
            <div class="better-img-gen-card-header">
                <span class="better-img-gen-card-title">${escapeHtml(name)}</span>
                <span class="better-img-gen-badge ${charTags[name] ? 'has-tags' : 'no-tags'}">
                    ${charTags[name] ? 'Tags Set' : 'No Tags'}
                </span>
                <span class="better-img-gen-card-toggle">▶</span>
            </div>
            <div class="better-img-gen-card-body">
                <div class="better-img-gen-field" style="margin-bottom:8px;">
                    <label>SD Tags</label>
                    <textarea class="better-img-gen-textarea better-img-gen-char-tags" rows="4"
                              placeholder="Enter SD tags (comma-separated)...">${escapeHtml(charTags[name] || '')}</textarea>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="better-img-gen-btn better-img-gen-btn-primary better-img-gen-char-tags-save">Save Tags</button>
                    <button class="better-img-gen-btn better-img-gen-char-tags-generate">🤖 Generate from LLM</button>
                    <button class="better-img-gen-btn better-img-gen-btn-danger better-img-gen-char-tags-clear">Clear</button>
                </div>
            </div>
        </div>
    `).join('');

    return `
        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">🤖 Character Tag Gen Prompt</div>
            <div class="better-img-gen-section-subtitle">LLM instruction used when auto-generating SD tags for a character.</div>
            <textarea class="better-img-gen-textarea" id="better-img-gen-char-tag-gen-prompt" rows="3">${escapeHtml(s.characterTagGenPrompt)}</textarea>
        </div>
        <div class="better-img-gen-section">
            <div class="better-img-gen-section-title">👤 Character SD Tags</div>
            <div class="better-img-gen-section-subtitle">Per-character Stable Diffusion tags stored in extension storage.</div>
            <div id="better-img-gen-char-list">
                ${charCardsHtml || '<p style="color:#8a7a60;">No characters with stored tags yet. Tags will appear here when you add them.</p>'}
            </div>
        </div>
    `;
}

function getOptions(items, selected) {
    if (!items || !items.length) return '';
    return items.map(item => {
        const val = typeof item === 'string' ? item : (item.name || item);
        const sel = val === selected ? 'selected' : '';
        return `<option value="${escapeHtml(val)}" ${sel}>${escapeHtml(val)}</option>`;
    }).join('');
}

function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
        .replace(new RegExp('&', 'g'), '&' + 'amp;')
        .replace(new RegExp('<', 'g'), '&' + 'lt;')
        .replace(new RegExp('>', 'g'), '&' + 'gt;')
        .replace(new RegExp('"', 'g'), '&' + 'quot;')
        .replace(new RegExp("'", 'g'), '&' + '#39;');
}

// ── Export/Import ───────────────────────────────────────────

function exportSettings() {
    const settings = getSettings();
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'better-img-gen-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Settings exported.');
}

function importSettings(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            extension_settings[SETTINGS_KEY] = imported;
            saveSettingsDebounced();
            toastr.success('Settings imported successfully.');
        } catch (err) {
            toastr.error('Invalid settings file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// ── Utility Functions ─────────────────────────────────────

function getExtensionId() {
    return EXTENSION_ID;
}

function getExtensionName() {
    return EXTENSION_NAME;
}
