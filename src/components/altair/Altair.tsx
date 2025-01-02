/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { useEffect, useRef, useState, memo } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext";
import { ToolCall, LiveFunctionResponse } from "../../multimodal-live-types";

import fetch from 'node-fetch';
import stringSimilarity from 'string-similarity';

const get_skills_declaration: FunctionDeclaration = {
  name: "get_skills",
  description: "Get the skills from Google Cloud Skill Boost.",
};

const generate_learing_journey_declaration: FunctionDeclaration = {
  name: "generate_learing_journey",
  description: "generate learning instructions, steps and journey from Google Cloud Skill Boost for the user with a specific goal.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      goal: {
        type: SchemaType.STRING,
        description:
          "The goal which learner want to achieve in the learning journey.",
      },
    },
    required: ["goal"],
  }
}

const search_learning_content_declaration: FunctionDeclaration = {
  name: "search_learning_content",
  description: "search the learning contents, including labs and courses, from Google Cloud Skill Boost with a specific concept.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      concept: {
        type: SchemaType.STRING,
        description:
          "The concept which learner want to learn.",
      },
    },
    required: ["concept"],
  }
}

const start_lab_declaration: FunctionDeclaration = {
  name: "start_lab",
  description: "Open a lab or course template with specific name and start learning.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      name: {
        type: SchemaType.STRING,
        description:
          "The title of the lab or course template.",
      },
    },
    required: ["name"],
  }
}

function AltairComponent() {
  const [jsonString, setJSONString] = useState<string>("");
  const [learning_journey_json, setLearningJourneyJson] = useState<Array<any>>();
  let learning_journey_goal: string = '';
  const [contents_json, setContentsJson] = useState<Array<Array<any>>>([]);
  const [learning_content_concepts, setLearningContentConcepts] = useState<Array<string>>([]);

  let catalog_response_json;

  const { client, setConfig } = useLiveAPIContext();

  useEffect(() => {
    setConfig({
      model: "models/gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: "audio",
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
        },
      },
      systemInstruction: {
        parts: [
          {
            text: 'You are a helpful teaching assistant from Google Cloud Skill Boost, an online learning platform specializing in Google Cloud Technology. ' + 
            'Your role is to support students with their learning content and guide them through their educational journey.',
          },
        ],
      },
      tools: [
        // there is a free-tier quota for search
        // { googleSearch: {} },
        { functionDeclarations: [get_skills_declaration, generate_learing_journey_declaration, search_learning_content_declaration, start_lab_declaration] },
      ],
    });
  }, [setConfig]);

  useEffect(() => {
    const onToolCall = async (toolCall: ToolCall) => {
      console.log(`got toolcall`, toolCall);

      let function_responses: Array<LiveFunctionResponse> = [];
      for (const fc of toolCall.functionCalls) {
        if (fc.name === get_skills_declaration.name) {
          function_responses.push({
            response: { output: ['Bigquery', 'Logging', 'Cloud Run'] },
            id: fc.id,
          });
        } else if (fc.name === generate_learing_journey_declaration.name) {
          learning_journey_goal = (fc.args as any)["goal"];
          const requestHeaders: HeadersInit = {
            'Content-Type': 'application/json'
          };
          const response = await fetch('https://us-central1-learnahoy.cloudfunctions.net/generateLearningPath', {
            method: 'POST',
            headers: requestHeaders,
            body: '{"data":{"topic":"learning cloud technology","level":"beginner","specificGoal":"' + learning_journey_goal + '"}}'
          });
          const data = await response.json();
          console.log(data);
          const high_leverage_concept = data['data']['learningPath']['highLeverageConcepts'];
          const trim_high_leverage_concept = high_leverage_concept
            .map(({ title, effortPercentage, impactPercentage, timeToLearn }) => ({ title, effortPercentage, impactPercentage, timeToLearn}));
          // Update UI
          setLearningJourneyJson(high_leverage_concept);
          function_responses.push({
            response: { output: high_leverage_concept },
            id: fc.id,
          });
        } else if (fc.name === search_learning_content_declaration.name) {
          const concept = (fc.args as any)["concept"];
          setLearningContentConcepts(learning_content_concepts => learning_content_concepts.concat([concept]));

          if (!catalog_response_json) {
            const auth_body = 'access_key=&secret_key=';
            const authRequestHeaders: HeadersInit = {
              'Content-Type': 'application/x-www-form-urlencoded',
              'accept': 'application/json',
            };
            const auth_response = await fetch('https://www.cloudskillsboost.google/api/v2/authenticate', {
              method: 'POST',
              headers: authRequestHeaders,
              body: auth_body
            });
            const auth_data = await auth_response.json();
            const auth_token = auth_data['auth_token'];
            const lab_request_headers: HeadersInit = {
              'accept': 'application/json',
              'Authorization': 'Bearer ' + auth_token,
            };

            const catalog_response = await fetch('https://www.cloudskillsboost.google/api/v2/catalogs/gcp-self-paced-labs-all-public/items?per_page=900', {
                headers: lab_request_headers,
            });
            catalog_response_json = await catalog_response.json();
            console.log(catalog_response_json);
          }

          const sorted_catalog_data = catalog_response_json
            .map( ({ content_type, title, level, content_catalog_url}) => ({ content_type, title, level, url: content_catalog_url, similarity: stringSimilarity.compareTwoStrings(concept, title)}))
            .sort( (c1, c2) => c2.similarity - c1.similarity);
          let trim_catalog_data: Array<any> = [];
          let num_of_course = 0;
          for (const catalog_data of sorted_catalog_data) {
            if (trim_catalog_data.length === 10) {
              break;
            }
            if (catalog_data['content_type'] !== 'Lab') {
              trim_catalog_data.push(catalog_data);
              num_of_course += 1;
              continue;
            }
            if (10 - trim_catalog_data.length > 2 - num_of_course) {
              trim_catalog_data.push(catalog_data);
            }
          }
          
          // Update UI
          setContentsJson(contents_json => contents_json.concat([trim_catalog_data]));
          function_responses.push({
            response: { output: trim_catalog_data },
            id: fc.id,
          });
        } else if (fc.name === start_lab_declaration.name) {
          let found_content;
          let similarity = 0;
          if (catalog_response_json) {
            const name = (fc.args as any)["name"];
            for (const learning_content of catalog_response_json) {
              let current_similarity = stringSimilarity.compareTwoStrings(learning_content.title, name);
              if (current_similarity > similarity) {
                similarity = current_similarity;
                found_content = learning_content;
              }
            }
          }
          if (similarity < 0.75) {
            function_responses.push({
              response: { error: "No learning content found on Google Cloud Skill Boost" },
              id: fc.id,
            });
          } else{
            window.open(found_content.content_catalog_url, '_blank')?.focus();
            function_responses.push({
              response: { output: "Successfully open the learning content: " +  found_content.title},
              id: fc.id,
            });
          }
        }
      };
      client.sendToolResponse({
        functionResponses: function_responses,
      });
    };
    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  const learning_journey_ref = useRef<HTMLDivElement>(null);

  return <div className="vega-embed" ref={learning_journey_ref}>
    <h2>Learning Journey</h2>
    <h4>Goal: {learning_journey_goal}</h4>
    <table>
      <thead>
        <th>Title</th>
        <th>Effort Percentage</th>
        <th>Impact Percentage</th>
        <th>Time</th>
      </thead>
      <tbody>
        {learning_journey_json?.map((row: any, index: any) => (
          <tr key={index}>
            <td>{row.title}</td>
            <td>{row.effortPercentage}</td>
            <td>{row.impactPercentage}</td>
            <td>{row.timeToLearn}</td>
          </tr>    
        ))}
      </tbody>
    </table>
    <h2>GCSB Learning Contents</h2>
    {learning_content_concepts.map((concept: string, concept_index: any) => (
      <div>
        <h4>Learning Content: {concept}</h4>
        <table>
          <thead>
            <th>Content Type</th>
            <th>Title</th>
            <th>Level</th>
            <th>Link</th>
          </thead>
          <tbody>
            {contents_json[concept_index]?.map((row: any, index: any) => (
              <tr key={index}>
                <td>{row.content_type}</td>
                <td>{row.title}</td>
                <td>{row.level}</td>
                <td><a href={row.url} target="_blank">Jump to GCSB</a></td>
              </tr>    
            ))}
          </tbody>
        </table>
      </div>
    ))}
  </div>;
}

export const Altair = memo(AltairComponent);
