// Azure Functions v4 entry point
// Loads all HTTP function files which self-register with the runtime

require("./functions/health");
require("./functions/register");
require("./functions/token");
require("./functions/trigger");
require("./functions/sites");
require("./functions/variable");
require("./functions/variables");
require("./functions/variableExists");
require("./functions/validate");
require("./functions/tracker");
