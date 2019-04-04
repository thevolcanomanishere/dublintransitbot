import * as functions from "firebase-functions";
import { luas_stops } from "./luas_stops";
import { rail_stops } from "./rail_stops";
import Axios from "axios";
import * as xml2json from "xml2json";
import { TextDecoder } from "util";
import * as FuzzySet from "fuzzyset.js";
import * as TableToJson from "tabletojson";
import { start } from "repl";
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

const fuzzyListLuas = () => {
  const red = luas_stops["Red Line"];
  const green = luas_stops["Green Line"];
  const combined = [...red, ...green];
  return FuzzySet(combined.map(stop => stop.text));
};

const fuzzyListRail = () => {
  return FuzzySet(rail_stops.map(stop => stop.Desc));
};

const isObject = value =>
  value && typeof value === "object" && value.constructor === Object;

const getLuasStopInfo = (displayName: string) => {
  const filteredStopRed = luas_stops["Red Line"].find(
    stop => stop.text === displayName
  );
  const filteredStopGreen = luas_stops["Green Line"].find(
    stop => stop.text === displayName
  );

  if (filteredStopRed) return filteredStopRed;
  return filteredStopGreen;
};

const LuasApi = abbreviation => {
  const apiUrl = "https://luasforecasts.rpa.ie/xml/get.ashx";

  const qs = {
    stop: abbreviation,
    action: "forecast",
    encrypt: false
  };

  return Axios.get(apiUrl, {
    params: qs
  }).then(result => {
    return xml2json.toJson(result.data, {
      sanitize: true,
      trim: true,
      object: true
    });
  });
};

const RailApi = stopName => {
  const apiUrl = `http://api.irishrail.ie/realtime/realtime.asmx/getStationDataByNameXML?StationDesc=${stopName}&NumMins=20`;
  return Axios.get(apiUrl).then(result => {
    return xml2json.toJson(result.data, {
      sanitize: true,
      trim: true,
      object: true
    });
  });
};

const BusApi = stopNumber => {
  const apiUrl = `https://www.dublinbus.ie/RTPI/Sources-of-Real-Time-Information/?searchtype=view&searchquery=${stopNumber}`;
  return TableToJson.convertUrl(apiUrl, tablesAsJson => {
    return {
      stopAddress: tablesAsJson[2],
      realTime: tablesAsJson[3]
    };
  });
};

const minsOrDue = text => {
  if (text === "DUE") {
    return text;
  } else if (text === "1") {
    return `${text} min`;
  }
  return `${text} mins`;
};

const generateTextForMultiple = trams => {
  const text = trams.map(tram => {
    return `\n${tram.destination}: ${minsOrDue(tram.dueMins)}`;
  });

  return `${text.join("")}`;
};

const generateInboundAndOutboundLuas = apiResponse => {
  const Inbound = apiResponse.direction[0].tram;
  const Outbound = apiResponse.direction[1].tram;
  let inboundMessage = "";
  let outboundMessage = "";
  if (isObject(Inbound)) {
    if (Inbound.destination === "No trams forecast") {
      inboundMessage = `\nInbound: \nNo trams forecast 😔`;
    }
    inboundMessage = `\nInbound: \n${Inbound.destination}: ${minsOrDue(
      Inbound.dueMins
    )}`;
  } else {
    inboundMessage = `\nInbound: ${generateTextForMultiple(Inbound)}`;
  }

  if (isObject(Outbound)) {
    if (Inbound.destination === "No trams forecast") {
      outboundMessage = `\nOutbound: \nNo trams forecast 😔`;
    }
    outboundMessage = `\nOutbound:\n${Outbound.destination} ${minsOrDue(
      Outbound.dueMins
    )}`;
  } else {
    outboundMessage = `\nOutbound: ${generateTextForMultiple(Outbound)}`;
  }
  return `${inboundMessage}\n${outboundMessage}`;
};

const generateInboundAndOutboundRail = (apiResponse, stopName) => {
  const list = apiResponse.ArrayOfObjStationData.objStationData;
  const northboundList = list.filter(item => item.Direction === "Northbound");
  const southboundList = list.filter(item => item.Direction === "Southbound");

  const northboundText = northboundList.map(item => {
    return `${item.Origin} -> ${item.Destination}: ${item.Duein} mins`;
  });

  const southboundText = southboundList.map(item => {
    return `${item.Origin} -> ${item.Destination}: ${item.Duein} mins`;
  });

  return `Times for ${stopName}\n\nNorthbound\n${northboundText.join(
    "\n"
  )}\n\nSouthbound\n${southboundText.join("\n")}`;
};

// const getLuasStopTimes = (stopName, res) => {
//   const luasStopInfo = getLuasStopInfo(stopName);

//   return LuasApi(luasStopInfo.abrev).then(result => {
//     const startMessage = generateInboundAndOutboundLuas(result.stopInfo);

//     res.json({
//       fulfillmentText: `Getting times for ${
//         luasStopInfo.text
//       }🚈\n${startMessage}`
//     });
//   });
// };

const generateBusMessage = apiResponse => {
  if (apiResponse.length === 2)
    return "That is not a valid stop number. Please check here https://www.dublinbus.ie/RTPI/Sources-of-Real-Time-Information/";

  const stopAddress = apiResponse.stopAddress[0]["Stop Address"];
  const stopNumber = apiResponse.stopAddress[0]["Stop Number"];

  const liveInfo = apiResponse.realTime.map(stop => {
    return `Route: ${stop.Route}   Due: ${stop["Expected Time"]} `;
  });

  return `Dublin Bus Times 🚌\n\nAddress: ${stopAddress}\n\n${liveInfo.join(
    "\n"
  )}`;
};

const getLuasStopTimes = (stopName, res) => {
  const luasStopInfo = getLuasStopInfo(stopName);

  return LuasApi(luasStopInfo.abrev).then(result => {
    const startMessage = generateInboundAndOutboundLuas(result.stopInfo);

    return res.json({
      fulfillmentText: `Getting times for ${
        luasStopInfo.text
      }🚈\n${startMessage}`
    });
  });
};

const getRailStopTimes = (stopName, res) => {
  console.log("Getting stop times for rail");
  return RailApi(stopName).then(result => {
    const startMessage = generateInboundAndOutboundRail(result, stopName);
    return res.json({
      fulfillmentText: startMessage
    });
  });
};

const getBusStopTimes = (stopNumber, res) => {
  return BusApi(stopNumber).then(result => {
    const startMessage = generateBusMessage(result);
    return res.json({
      payload: {
        facebook: {
          version: "v2",
          content: {
            messages: [
              {
                type: "text",
                text: startMessage
              }
            ]
          }
        }
      }
    });
  });
};

const railEdgeCase = (stopName, res) => {
  console.log("Edge case");
  switch (stopName.toLowerCase()) {
    case "pearse":
      return getRailStopTimes("Dublin Pearse", res);
    case "heuston":
      return getRailStopTimes("Dublin Heuston", res);
    case "connolly":
      return getRailStopTimes("Dublin Connolly", res);
    default:
      return res.json({
        fulfillmentText: "Oops something went wrong with this edge case"
      });
      break;
  }
};

const edgeCases = ["pearse", "connolly", "heuston"];

export const dublinTransitBot = functions
  .region("europe-west1")
  .https.onRequest((req, res) => {
    const intent = req.body.queryResult.intent.displayName;
    const queryText = req.body.queryResult.queryText;
    console.log(`Intent: ${intent}. Query: ${queryText}`);

    let luas_stop;

    const queryWords = queryText.split();

    if (!isNaN(queryText)) {
      return getBusStopTimes(queryText, res);
    }

    // check edge cases
    if (edgeCases.includes(queryText.toLowerCase())) {
      return railEdgeCase(queryText, res);
    }

    if (intent === "rail.get-stop-times") {
      const stop_name = req.body.queryResult.parameters.rail_stops;
      return getRailStopTimes(stop_name, res);
    }

    if (intent === "Default Fallback Intent" && queryWords.length === 1) {
      const fsLuas = fuzzyListLuas();
      const fsRail = fuzzyListRail();
      const fuzzyLuasStop = fsLuas.get(queryText);
      const fuzzyRailStop = fsRail.get(queryText);
      console.log(`Fuzzy Luas: ${fuzzyLuasStop}`);
      console.log(`Fuzzy Rail: ${fuzzyRailStop}`);

      luas_stop = fuzzyLuasStop[0][1];

      if (fuzzyLuasStop[0][0] > fuzzyRailStop[0][0]) {
        return getLuasStopTimes(fuzzyLuasStop[0][1], res);
      }
      return getRailStopTimes(fuzzyRailStop[0][1], res);
    }

    if (intent === "luas.get-stop-times") {
      luas_stop = req.body.queryResult.parameters.luas_stop;
      return getLuasStopTimes(luas_stop, res);
    }
    return res.json({ fulfillmentText: "Oops, something went wrong." });
  });

const response = {
  stopInfo: {
    _attributes: {
      created: "2019-03-14T22:37:25",
      stop: "Cowper",
      stopAbv: "COW"
    },
    message: {
      _text: "Green Line services operating normally"
    },
    direction: [
      {
        _attributes: {
          name: "Inbound"
        },
        tram: {
          _attributes: {
            dueMins: "9",
            destination: "Broombridge"
          }
        }
      },
      {
        _attributes: {
          name: "Outbound"
        },
        tram: [
          {
            _attributes: {
              dueMins: "1",
              destination: "Bride's Glen"
            }
          },
          {
            _attributes: {
              dueMins: "11",
              destination: "Bride's Glen"
            }
          }
        ]
      }
    ]
  }
};

// export interface LuasResponse {
//   stopInfo: StopInfo;
// }

// export interface StopInfo {
//   _attributes: StopInfoAttributes;
//   message: Message;
//   direction: Direction[];
// }

// export interface StopInfoAttributes {
//   created: Date;
//   stop: string;
//   stopAbv: string;
// }

// export interface Direction {
//   _attributes: DirectionAttributes;
//   tram: TramElement[] | TramElement;
// }

// export interface DirectionAttributes {
//   name: string;
// }

// export interface TramElement {
//   _attributes: TramAttributes;
// }

// export interface TramAttributes {
//   dueMins: string;
//   destination: string;
// }

// export interface Message {
//   _text: string;
// }
