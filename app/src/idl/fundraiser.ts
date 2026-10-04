/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fundraiser.json`.
 */
export type Fundraiser = {
  "address": "HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw",
  "metadata": {
    "name": "fundraiser",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Trustless group fundraiser: goal reached -> only the recipient withdraws; goal missed -> every contributor reclaims their exact contribution."
  },
  "instructions": [
    {
      "name": "cancel",
      "docs": [
        "Call the campaign off before its goal is reached, opening refunds.",
        "Signer: the organizer."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "organizer",
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeCampaign",
      "docs": [
        "Reclaim the rent deposits once everything is settled. Signer: the organizer."
      ],
      "discriminator": [
        65,
        49,
        110,
        7,
        63,
        238,
        206,
        77
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "campaign.mint",
                "account": "campaign"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "contribute",
      "docs": [
        "Put USDC in. Signer: anyone while Active and before the deadline; for",
        "a private campaign, also the invite key from the share link.",
        "`expected_recipient` must match the campaign's current recipient."
      ],
      "discriminator": [
        82,
        33,
        68,
        131,
        32,
        0,
        205,
        95
      ],
      "accounts": [
        {
          "name": "contributor",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "contribution",
          "docs": [
            "Created on the contributor's first contribution, topped up afterwards."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The campaign's own mint (always USDC_MINT); needed by transfer_checked."
          ]
        },
        {
          "name": "contributorToken",
          "docs": [
            "Where the money comes from: the contributor's own token account for",
            "this mint."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Where the money goes: this campaign's vault and nothing else."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "invite",
          "docs": [
            "Only for private campaigns: the invite key from the organizer's share",
            "link, co-signing to prove the contributor actually holds that link."
          ],
          "signer": true,
          "optional": true
        },
        {
          "name": "recipient",
          "docs": [
            "The next three are only for the contribution that completes the goal:",
            "with them, that same contribution pays the recipient at once, so the",
            "money reaches the shop (or friend) the moment the goal is hit, with no",
            "one having to press \"pay out\". Required when the campaign is a shop",
            "order (it stores a payment reference).",
            "",
            "identifies who the money is for. Never signs."
          ],
          "optional": true
        },
        {
          "name": "recipientToken",
          "docs": [
            "The recipient's token account for the campaign's mint. Must already",
            "exist: the app creates it in the same transaction if needed. Owner and",
            "mint are checked in the handler.",
            "",
            "`dup`: when the recipient completes their own campaign (e.g. the",
            "organizer is the recipient and chips in the last part), this is the",
            "same account as `contributor_token`. That is fine: it is owned by the",
            "token program, so Anchor never writes it back, and the token program",
            "handles both transfers correctly."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "reference",
          "docs": [
            "stored Solana Pay reference, so the shop can find the payment."
          ],
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "nickname",
          "type": "string"
        },
        {
          "name": "expectedRecipient",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "createCampaign",
      "docs": [
        "Open a campaign. Signer: the organizer, who pays rent and nothing else."
      ],
      "discriminator": [
        111,
        131,
        187,
        98,
        160,
        193,
        114,
        244
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "organizer"
              },
              {
                "kind": "arg",
                "path": "campaignId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Only the configured USDC mint; any other token is refused."
          ],
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "vault",
          "docs": [
            "The escrow: the campaign's own associated token account for `mint`.",
            "Its authority is the campaign PDA, so only this program can move it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "campaignId",
          "type": "u64"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "goal",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "recipient",
          "type": "pubkey"
        },
        {
          "name": "invite",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "tags",
          "type": "u32"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "imageUrl",
          "type": "string"
        },
        {
          "name": "reference",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "memo",
          "type": "string"
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "Take your own money back. Signer: that contributor, once the deadline",
        "passed without reaching the goal, or the campaign was cancelled."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "contributor",
          "docs": [
            "The contributor, asking for their own money back. Nobody else's",
            "permission is needed."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "contribution"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          },
          "relations": [
            "contribution"
          ]
        },
        {
          "name": "contribution",
          "docs": [
            "The receipt. `close = contributor` deletes it as it pays out and hands",
            "its rent back, which is what makes a second refund impossible."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  116,
                  114,
                  105,
                  98,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "contributor"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "contributorToken",
          "docs": [
            "The contributor's own associated token account, reopened if they",
            "closed it since contributing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "contributor"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateRecipient",
      "docs": [
        "Fix the recipient (with its Solana Pay reference and memo) before",
        "anyone has contributed. Signer: the organizer."
      ],
      "discriminator": [
        55,
        190,
        61,
        121,
        131,
        132,
        8,
        54
      ],
      "accounts": [
        {
          "name": "organizer",
          "signer": true,
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newRecipient",
          "type": "pubkey"
        },
        {
          "name": "reference",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "memo",
          "type": "string"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "Pay what was raised (the goal) to the stored recipient once the goal",
        "is reached, even before the deadline. Must carry the campaign's",
        "Solana Pay reference when it has one. Signer: anyone (permissionless)."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Anyone. Withdrawing is permissionless: whoever calls it, the money can",
            "only go to the stored recipient. The caller pays the transaction fee",
            "and, if needed, the rent to open the recipient's token account."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "campaign",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  109,
                  112,
                  97,
                  105,
                  103,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "campaign.organizer",
                "account": "campaign"
              },
              {
                "kind": "account",
                "path": "campaign.campaignId",
                "account": "campaign"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "docs": [
            "owner of the token account the money goes to. Never signs."
          ],
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "campaign"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "campaign"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipientToken",
          "docs": [
            "The recipient's own associated token account, opened here if it does",
            "not exist yet, so a payout can never be blocked by a missing account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "reference",
          "docs": [
            "campaign stores a Solana Pay reference this must be exactly that",
            "account (checked in the handler), so the payout transaction is always",
            "findable by the shop's reference. Otherwise it is optional."
          ],
          "optional": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "campaign",
      "discriminator": [
        50,
        40,
        49,
        11,
        157,
        220,
        229,
        192
      ]
    },
    {
      "name": "contribution",
      "discriminator": [
        182,
        187,
        14,
        111,
        72,
        167,
        242,
        212
      ]
    }
  ],
  "events": [
    {
      "name": "campaignCreated",
      "discriminator": [
        9,
        98,
        69,
        61,
        53,
        131,
        64,
        152
      ]
    },
    {
      "name": "cancelled",
      "discriminator": [
        136,
        23,
        42,
        65,
        143,
        233,
        234,
        46
      ]
    },
    {
      "name": "contributed",
      "discriminator": [
        196,
        199,
        157,
        136,
        180,
        222,
        100,
        118
      ]
    },
    {
      "name": "recipientUpdated",
      "discriminator": [
        33,
        28,
        22,
        205,
        175,
        9,
        165,
        73
      ]
    },
    {
      "name": "refunded",
      "discriminator": [
        35,
        103,
        149,
        246,
        196,
        123,
        221,
        99
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "deadlineNotReached",
      "msg": "The deadline has not been reached yet"
    },
    {
      "code": 6001,
      "name": "deadlinePassed",
      "msg": "The deadline has already passed"
    },
    {
      "code": 6002,
      "name": "goalNotReached",
      "msg": "The campaign did not reach its goal"
    },
    {
      "code": 6003,
      "name": "goalReached",
      "msg": "The campaign reached its goal, so contributions cannot be refunded"
    },
    {
      "code": 6004,
      "name": "notRecipient",
      "msg": "Only the recipient set at creation can withdraw"
    },
    {
      "code": 6005,
      "name": "alreadyWithdrawn",
      "msg": "The funds have already been withdrawn"
    },
    {
      "code": 6006,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6007,
      "name": "titleTooLong",
      "msg": "Title must be at most 64 bytes"
    },
    {
      "code": 6008,
      "name": "invalidGoal",
      "msg": "Goal must be greater than zero"
    },
    {
      "code": 6009,
      "name": "invalidDeadline",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6011,
      "name": "campaignNotSettled",
      "msg": "Campaign can only be closed after a withdrawal or after every contribution was refunded"
    },
    {
      "code": 6012,
      "name": "inviteRequired",
      "msg": "This campaign is private: contributing requires the organizer's invite link"
    },
    {
      "code": 6013,
      "name": "invalidInvite",
      "msg": "This invite does not belong to this campaign"
    },
    {
      "code": 6014,
      "name": "nicknameTooLong",
      "msg": "Nickname must be at most 32 bytes"
    },
    {
      "code": 6015,
      "name": "tooManyTags",
      "msg": "A campaign can have at most 5 tags"
    },
    {
      "code": 6016,
      "name": "descriptionTooLong",
      "msg": "Description must be at most 300 bytes"
    },
    {
      "code": 6017,
      "name": "imageUrlTooLong",
      "msg": "Image link must be at most 200 bytes"
    },
    {
      "code": 6018,
      "name": "invalidImageUrl",
      "msg": "Image link must be empty or start with https://"
    },
    {
      "code": 6019,
      "name": "wrongMint",
      "msg": "This program only accepts the configured USDC mint"
    },
    {
      "code": 6020,
      "name": "notOrganizer",
      "msg": "Only the organizer of this campaign can do this"
    },
    {
      "code": 6021,
      "name": "campaignNotActive",
      "msg": "The campaign is no longer taking changes"
    },
    {
      "code": 6022,
      "name": "recipientLocked",
      "msg": "The recipient is locked once anyone has contributed"
    },
    {
      "code": 6023,
      "name": "invalidRecipient",
      "msg": "The recipient must be a real address"
    },
    {
      "code": 6024,
      "name": "recipientChanged",
      "msg": "The recipient changed since you looked; check the campaign again"
    },
    {
      "code": 6025,
      "name": "campaignCancelled",
      "msg": "The campaign was cancelled; contributors can take their money back"
    },
    {
      "code": 6026,
      "name": "memoTooLong",
      "msg": "Memo must be at most 64 bytes"
    },
    {
      "code": 6027,
      "name": "referenceRequired",
      "msg": "This payout must carry the campaign's payment reference"
    },
    {
      "code": 6028,
      "name": "wrongReference",
      "msg": "This is not the campaign's payment reference"
    },
    {
      "code": 6029,
      "name": "exceedsGoal",
      "msg": "This contribution is more than the amount still needed to reach the goal"
    },
    {
      "code": 6030,
      "name": "payoutAccountsRequired",
      "msg": "This contribution completes a shop order, so it must pay the shop in the same transaction"
    },
    {
      "code": 6031,
      "name": "wrongRecipientAccount",
      "msg": "That token account does not belong to the campaign's recipient"
    }
  ],
  "types": [
    {
      "name": "campaign",
      "docs": [
        "One fundraiser. The money is not held here: it sits in this campaign's",
        "vault, its associated token account for `mint`, which only this program",
        "can move -- to the recipient on success, or back to each contributor.",
        "",
        "Fixed-size fields come first so they sit at fixed offsets for",
        "`getProgramAccounts` memcmp filters:",
        "organizer 8, recipient 40, mint 72, campaign_id 104, status 112."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "organizer",
            "docs": [
              "Created the campaign and pays its rent. Can change the recipient only",
              "while nothing has been raised, and has no power over the money."
            ],
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "docs": [
              "Where the pot goes on success. Locked by the first contribution."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "The token this campaign raises: always the configured `USDC_MINT`."
            ],
            "type": "pubkey"
          },
          {
            "name": "campaignId",
            "docs": [
              "Organizer-chosen id, lets one organizer run many campaigns."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "campaignStatus"
              }
            }
          },
          {
            "name": "title",
            "docs": [
              "Human-readable name, at most `MAX_TITLE_LEN` bytes."
            ],
            "type": "string"
          },
          {
            "name": "goal",
            "docs": [
              "Target in the mint's base units. Reaching it is what unlocks `withdraw`."
            ],
            "type": "u64"
          },
          {
            "name": "deadline",
            "docs": [
              "Unix timestamp after which no more contributions are accepted."
            ],
            "type": "i64"
          },
          {
            "name": "totalRaised",
            "docs": [
              "Sum of every contribution ever made."
            ],
            "type": "u64"
          },
          {
            "name": "totalRefunded",
            "docs": [
              "Sum of every refund ever paid out."
            ],
            "type": "u64"
          },
          {
            "name": "invite",
            "docs": [
              "`Some` makes the campaign private: `contribute` then requires this key",
              "to co-sign. Its secret travels only inside the organizer's share link,",
              "so only people holding that link can join. `None` means public.",
              "",
              "This restricts who can *contribute*. It does not hide the campaign:",
              "every account on Solana is readable by anyone."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "tags",
            "docs": [
              "Up to `MAX_TAGS` labels (\"Trip\", \"Medical\", …) as a bitmask, so the",
              "app can filter and search without a database. The catalogue of what",
              "each bit means lives in the app (`app/src/lib/tags.ts`); the program",
              "only stores them, as plain descriptive metadata, never as a rule."
            ],
            "type": "u32"
          },
          {
            "name": "description",
            "docs": [
              "What the money is for, in the organizer's words. Fixed at creation."
            ],
            "type": "string"
          },
          {
            "name": "imageUrl",
            "docs": [
              "An `https://` link to a photo hosted elsewhere, or empty. Only the link",
              "is fixed on chain -- whoever hosts the image could still change it."
            ],
            "type": "string"
          },
          {
            "name": "reference",
            "docs": [
              "Solana Pay: when set, every payout must carry this account (read-only),",
              "so the shop that asked for the payment can find it by its reference.",
              "Changeable only together with the recipient, before any contribution."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "memo",
            "docs": [
              "Solana Pay: the shop's memo, added to the payout transaction by the",
              "app. Empty when none. Same change rules as `reference`."
            ],
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "campaignCreated",
      "docs": [
        "Emitted by `create_campaign`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "organizer",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "goal",
            "type": "u64"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "private",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "campaignStatus",
      "docs": [
        "Where a campaign is in its life. Stored, not derived, so every rule can",
        "check it directly and the app can filter on it."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "succeeded"
          },
          {
            "name": "withdrawn"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "cancelled",
      "docs": [
        "Emitted by `cancel`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "totalRaised",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "contributed",
      "docs": [
        "Emitted by `contribute`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "contributorTotal",
            "docs": [
              "This contributor's running total in the campaign."
            ],
            "type": "u64"
          },
          {
            "name": "totalRaised",
            "type": "u64"
          },
          {
            "name": "goalReached",
            "docs": [
              "True when this contribution reached the goal (status became Succeeded)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "contribution",
      "docs": [
        "One contributor's running total for one campaign. Its existence is the",
        "receipt that entitles them to a refund if the goal is missed; `refund`",
        "closes it, which is what makes a double refund impossible."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "docs": [
              "First field after the 8-byte discriminator, so the frontend can list a",
              "campaign's contributors with a single memcmp filter at offset 8."
            ],
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "nickname",
            "docs": [
              "How this contributor wants to be shown to the group, e.g. \"Kuba\".",
              "Chosen by the contributor, per campaign; empty means \"show my address\"."
            ],
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "recipientUpdated",
      "docs": [
        "Emitted by `update_recipient`, which is only possible before anyone has",
        "contributed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "oldRecipient",
            "type": "pubkey"
          },
          {
            "name": "newRecipient",
            "type": "pubkey"
          },
          {
            "name": "reference",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "memo",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "refunded",
      "docs": [
        "Emitted by `refund`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "contributor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalRefunded",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "docs": [
        "Emitted by `withdraw`. `caller` is whoever triggered it; the money always",
        "goes to `recipient`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "campaign",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "reference",
            "docs": [
              "The Solana Pay reference key, if one was passed."
            ],
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "campaignSeed",
      "docs": [
        "PDA seed prefix for `Campaign` accounts."
      ],
      "type": "bytes",
      "value": "[99, 97, 109, 112, 97, 105, 103, 110]"
    },
    {
      "name": "contributionSeed",
      "docs": [
        "PDA seed prefix for `Contribution` accounts."
      ],
      "type": "bytes",
      "value": "[99, 111, 110, 116, 114, 105, 98, 117, 116, 105, 111, 110]"
    },
    {
      "name": "usdcDecimals",
      "docs": [
        "USDC has 6 decimals on every cluster; `transfer_checked` verifies it."
      ],
      "type": "u8",
      "value": "6"
    },
    {
      "name": "usdcMint",
      "type": "pubkey",
      "value": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    }
  ]
};
