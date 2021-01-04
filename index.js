const fs = require("fs").promises;
const chalk = require("chalk");
const bent = require("bent");
const formurlencoded = require("form-urlencoded").default;
const { argv } = require("yargs");
const { format, subDays } = require("date-fns");

async function init() {
  // Get an access token and refresh token from
  // https://dev.fitbit.com/apps/oauthinteractivetutorial.
  let accessToken = await fs.readFile(".access_token", "utf8");
  let refreshToken = await fs.readFile(".refresh_token", "utf8");

  const refreshAuthorization = async () => {
    console.log(chalk.yellow("~~ REFRESH AUTHORIZATION ~~"));
    const clientId = await fs.readFile(".client_id", "utf8");
    const clientSecret = await fs.readFile(".client_secret", "utf8");

    const authString = `Basic ${Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64")}`;

    console.log("authString", authString);

    const apiPost = bent(
      "https://api.fitbit.com/oauth2/",
      "POST",
      "json",
      200,
      {
        Authorization: authString,
        "Content-Type": "application/x-www-form-urlencoded",
      }
    );

    const response = await apiPost(
      "token",
      formurlencoded({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        expires_in: 30 * 1000,
      })
    );

    console.log("RESPONSE~!!!!!", response);

    const {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    } = response;

    // Store the tokens as files
    await fs.writeFile("./.access_token", newAccessToken);
    await fs.writeFile("./.refresh_token", newRefreshToken);

    accessToken = accessToken;
    refreshToken = refreshToken;
  };

  const api = bent("https://api.fitbit.com/1/user/-/", "GET", "json", 200, {
    Authorization: `Bearer ${accessToken}`,
    "Accept-Language": "en_US",
  });

  // Create a wrapper around the Fitbit API that will make a separate call to
  // refresh our token when necessary
  const callApi = async (url) => {
    try {
      return await api(url);
    } catch (err) {
      if (err.statusCode === 401) {
        await refreshAuthorization();
        return await api(url);
      }
    }
  };

  // Generate a list of the dates we'd like to get data for
  const dates = [];
  const days = argv.days || 1;
  for (let i = 1; i <= days; i += 1) {
    dates.unshift(subDays(new Date(), i));
  }

  // Get daily activity. This requires a separate call for each date.
  const activityData = await Promise.all(
    dates.map((d) => callApi(`activities/date/${format(d, "yyyy-MM-dd")}.json`))
  );

  // Get weight history. This is just a single call with a date range.
  const weightDataURL = `body/weight/date/${format(
    subDays(new Date(), days),
    "yyyy-MM-dd"
  )}/${format(new Date(), "yyyy-MM-dd")}.json`;

  const { "body-weight": weightData } = await callApi(weightDataURL);

  // Combine the activity data with the weight for each date
  const data = activityData.map((date, i) => {
    const combined = {
      ...date,
      weight: weightData[i].value,
    };

    return combined;
  });

  // Get today's weight -- it sits on its own, since there's no summary
  // information for it in our activity data
  const weightToday = weightData[weightData.length - 1].value;

  displayData({ dates, data, weightToday });
}

// Display our data
const displayData = ({ dates, data, weightToday }) => {
  console.log("\n", chalk.yellow(" Fitbit Logger"));
  console.log("--------------------------------------");
  data.forEach((datum, i) => {
    const steps = datum.summary.steps.toLocaleString();

    console.log(
      "*",
      chalk.cyan(format(dates[i], "EEE (MM/dd):")),
      chalk.green(`${datum.weight}`),
      "lbs,",
      chalk.yellow(steps),
      "steps"
    );
  });

  console.log(
    " ",
    chalk.yellow("Today:"),
    chalk.green(weightToday),
    "lbs",
    "\n"
  );
};

init();
