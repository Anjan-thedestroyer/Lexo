import { ethers } from "ethers";
import { CoreAgreementModel } from "../model/CoreAgreement.model.js";
import deployCore from "../helper/CoreAgreement.s.js";

export async function setCoreAgreement(req, res) {
  try {
    const { terms } = req.body;

    if (!terms || !req.file || !req.file.buffer) {
      return res.status(400).json({
        message: "Terms and TermsDocs are required",
        success: false,
      });
    }

    const termsHash = ethers.keccak256(req.file.buffer);

    const contractAddress = await deployCore(termsHash);

    const coreAgreement = await CoreAgreementModel.create({
      terms,
      termsDocs: req.file.buffer,
      termsHash,
      contractAddress,
    });

    return res.status(201).json({
      message: "Core agreement created successfully",
      success: true,
      data: coreAgreement,
    });
  } catch (error) {
    console.error("Error creating core agreement:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
}

export async function getCoreAgreement(req, res) {
  try {
    const coreAgreement = await CoreAgreementModel.findOne();
    return res.status(200).json({
      message: "Core agreement retrieved successfully",
      success: true,
      data: coreAgreement,
    });
  } catch (error) {
    console.error("Error retrieving core agreement:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
}

export async function checkCoreDocs(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        message: "termsDocs file is required",
        success: false,
      });
    }

    const hash = ethers.keccak256(req.file.buffer);
    const coreAgreement = await CoreAgreementModel.findOne({ termsHash: hash });

    if (coreAgreement) {
      return res.status(200).json({
        message: "Core agreement documents match",
        success: true,
        data: coreAgreement,
      });
    } else {
      return res.status(404).json({
        message: "Core agreement documents do not match",
        success: false,
      });
    }
  } catch (error) {
    console.error("Error checking core docs:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
}