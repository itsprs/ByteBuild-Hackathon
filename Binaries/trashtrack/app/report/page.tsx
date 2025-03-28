"use client"

import { useState, useCallback, useEffect } from "react"
import { MapPin, Upload, CheckCircle, Loader } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { StandaloneSearchBox, useJsApiLoader } from "@react-google-maps/api"
import { Libraries } from "@react-google-maps/api"
import {
  createUser,
  getUserByEmail,
  createReport,
  getRecentReports,
} from "@/utils/db/actions"
import { useRouter } from "next/navigation"
import { toast } from "react-hot-toast"

const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

const libraries: Libraries = ["places"]

export default function ReportPage() {
  const [user, setUser] = useState<{
    id: number
    email: string
    name: string
  } | null>(null)
  const router = useRouter()

  const [reports, setReports] = useState<
    Array<{
      id: number
      location: string
      wasteType: string
      amount: string
      createdAt: string
    }>
  >([])

  const [newReport, setNewReport] = useState({
    location: "",
    type: "",
    amount: "",
  })

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<
    "idle" | "verifying" | "success" | "failure"
  >("idle")
  const [verificationResult, setVerificationResult] = useState<{
    wasteType: string
    quantity: string
    confidence: number
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [searchBox, setSearchBox] =
    useState<google.maps.places.SearchBox | null>(null)

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: googleMapsApiKey!,
    libraries: libraries,
  })

  const onLoad = useCallback((ref: google.maps.places.SearchBox) => {
    setSearchBox(ref)
  }, [])

  const onPlacesChanged = () => {
    if (searchBox) {
      const places = searchBox.getPlaces()
      if (places && places.length > 0) {
        const place = places[0]
        setNewReport((prev) => ({
          ...prev,
          location: place.formatted_address || "",
        }))
      }
    }
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setNewReport({ ...newReport, [name]: value })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      setFile(selectedFile)
      const reader = new FileReader()
      reader.onload = (e) => {
        setPreview(e.target?.result as string)
      }
      reader.readAsDataURL(selectedFile)
    }
  }

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleVerify = async () => {
    if (!file) return

    setVerificationStatus("verifying")

    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey!)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

      const base64Data = await readFileAsBase64(file)

      const imageParts = [
        {
          inlineData: {
            data: base64Data.split(",")[1],
            mimeType: file.type,
          },
        },
      ]

      const prompt = `You are an expert in waste management and recycling. Analyze this image and provide:
        1. The type of waste (e.g., plastic, paper, glass, metal, organic)
        2. An estimate of the quantity or amount (in kg or liters)
        3. Your confidence level in this assessment (as a percentage)
        
        Respond in JSON format like this:
        {
          "wasteType": "type of waste",
          "quantity": "estimated quantity with unit",
          "confidence": confidence level as a number between 0 and 1
        }`

      const result = await model.generateContent([prompt, ...imageParts])
      const response = await result.response
      const text = response.text()

      try {
        const parsedResult = JSON.parse(text)
        if (
          parsedResult.wasteType &&
          parsedResult.quantity &&
          parsedResult.confidence
        ) {
          setVerificationResult(parsedResult)
          setVerificationStatus("success")
          setNewReport({
            ...newReport,
            type: parsedResult.wasteType,
            amount: parsedResult.quantity,
          })
        } else {
          console.error("Invalid verification result:", parsedResult)
          setVerificationStatus("failure")
        }
      } catch (error) {
        console.error("Failed to parse JSON response:", text)
        setVerificationStatus("failure")
      }
    } catch (error) {
      console.error("Error verifying waste:", error)
      setVerificationStatus("failure")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (verificationStatus !== "success" || !user) {
      toast.error("Please verify the waste before submitting or log in.")
      return
    }

    setIsSubmitting(true)
    try {
      const report = (await createReport(
        user.id,
        newReport.location,
        newReport.type,
        newReport.amount,
        preview || undefined,
        verificationResult ? JSON.stringify(verificationResult) : undefined
      )) as any

      const formattedReport = {
        id: report.id,
        location: report.location,
        wasteType: report.wasteType,
        amount: report.amount,
        createdAt: report.createdAt.toISOString().split("T")[0],
      }

      setReports([formattedReport, ...reports])
      setNewReport({ location: "", type: "", amount: "" })
      setFile(null)
      setPreview(null)
      setVerificationStatus("idle")
      setVerificationResult(null)

      toast.success(
        `Report submitted successfully! You've earned points for reporting waste.`
      )
    } catch (error) {
      console.error("Error submitting report:", error)
      toast.error("Failed to submit report. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    const checkUser = async () => {
      const email = localStorage.getItem("userEmail")
      if (email) {
        let user = await getUserByEmail(email)
        if (!user) {
          user = await createUser(email, "Anonymous User")
        }
        setUser(user)

        const recentReports = await getRecentReports()
        const formattedReports = recentReports.map((report) => ({
          ...report,
          createdAt: report.createdAt.toISOString().split("T")[0],
        }))
        setReports(formattedReports)
      } else {
        router.push("/login")
      }
    }
    checkUser()
  }, [router])

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-3xl font-semibold text-gray-800">
        Report waste
      </h1>

      <form
        onSubmit={handleSubmit}
        className="mb-12 rounded-2xl bg-white p-8 shadow-lg"
      >
        <div className="mb-8">
          <label
            htmlFor="waste-image"
            className="mb-2 block text-lg font-medium text-gray-700"
          >
            Upload Waste Image
          </label>
          <div className="mt-1 flex justify-center rounded-xl border-2 border-dashed border-gray-300 px-6 pb-6 pt-5 transition-colors duration-300 hover:border-green-500">
            <div className="space-y-1 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="flex text-sm text-gray-600">
                <label
                  htmlFor="waste-image"
                  className="relative cursor-pointer rounded-md bg-white font-medium text-green-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-green-500 hover:text-green-500"
                >
                  <span>Upload a file</span>
                  <input
                    id="waste-image"
                    name="waste-image"
                    type="file"
                    className="sr-only"
                    onChange={handleFileChange}
                    accept="image/*"
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="mb-8 mt-4">
            <img
              src={preview}
              alt="Waste preview"
              className="h-auto max-w-full rounded-xl shadow-md"
            />
          </div>
        )}

        <Button
          type="button"
          onClick={handleVerify}
          className="mb-8 w-full rounded-xl bg-blue-600 py-3 text-lg text-white transition-colors duration-300 hover:bg-blue-700"
          disabled={!file || verificationStatus === "verifying"}
        >
          {verificationStatus === "verifying" ? (
            <>
              <Loader className="-ml-1 mr-3 h-5 w-5 animate-spin text-white" />
              Verifying...
            </>
          ) : (
            "Verify Waste"
          )}
        </Button>

        {verificationStatus === "success" && verificationResult && (
          <div className="mb-8 rounded-r-xl border-l-4 border-green-400 bg-green-50 p-4">
            <div className="flex items-center">
              <CheckCircle className="mr-3 h-6 w-6 text-green-400" />
              <div>
                <h3 className="text-lg font-medium text-green-800">
                  Verification Successful
                </h3>
                <div className="mt-2 text-sm text-green-700">
                  <p>Waste Type: {verificationResult.wasteType}</p>
                  <p>Quantity: {verificationResult.quantity}</p>
                  <p>
                    Confidence:{" "}
                    {(verificationResult.confidence * 100).toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <label
              htmlFor="location"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Location
            </label>
            {isLoaded ? (
              <StandaloneSearchBox
                onLoad={onLoad}
                onPlacesChanged={onPlacesChanged}
              >
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={newReport.location}
                  onChange={handleInputChange}
                  required
                  className="w-full rounded-xl border border-gray-300 px-4 py-2 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="Enter waste location"
                />
              </StandaloneSearchBox>
            ) : (
              <input
                type="text"
                id="location"
                name="location"
                value={newReport.location}
                onChange={handleInputChange}
                required
                className="w-full rounded-xl border border-gray-300 px-4 py-2 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Enter waste location"
              />
            )}
          </div>
          <div>
            <label
              htmlFor="type"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Waste Type
            </label>
            <input
              type="text"
              id="type"
              name="type"
              value={newReport.type}
              onChange={handleInputChange}
              required
              className="w-full rounded-xl border border-gray-300 bg-gray-100 px-4 py-2 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Verified waste type"
              readOnly
            />
          </div>
          <div>
            <label
              htmlFor="amount"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Estimated Amount
            </label>
            <input
              type="text"
              id="amount"
              name="amount"
              value={newReport.amount}
              onChange={handleInputChange}
              required
              className="w-full rounded-xl border border-gray-300 bg-gray-100 px-4 py-2 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Verified amount"
              readOnly
            />
          </div>
        </div>
        <Button
          type="submit"
          className="flex w-full items-center justify-center rounded-xl bg-green-600 py-3 text-lg text-white transition-colors duration-300 hover:bg-green-700"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader className="-ml-1 mr-3 h-5 w-5 animate-spin text-white" />
              Submitting...
            </>
          ) : (
            "Submit Report"
          )}
        </Button>
      </form>

      <h2 className="mb-6 text-3xl font-semibold text-gray-800">
        Recent Reports
      </h2>
      <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className="transition-colors duration-200 hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    <MapPin className="mr-2 inline-block h-4 w-4 text-green-500" />
                    {report.location}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {report.wasteType}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {report.amount}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {report.createdAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
